/**
 * Web Serial API Manager
 * Handles port selection, connection lifecycle, SLIP packet I/O, and state management.
 */

import { SlipDecoder, slipEncode, parseResponse, sleep } from './esp-protocol.js';

// ── Connection States ──
const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    SYNCING: 'syncing',
    CONNECTED: 'connected',
    MONITORING: 'monitoring',
    FLASHING: 'flashing',
    ERROR: 'error',
};

/**
 * SerialManager — Web Serial API wrapper with SLIP framing and event system.
 */
class SerialManager extends EventTarget {
    constructor() {
        super();
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.readableStreamClosed = null;
        this.writableStreamClosed = null;
        this.state = ConnectionState.DISCONNECTED;
        this.baudRate = 115200;
        this.slipDecoder = new SlipDecoder();
        this._readLoopActive = false;
        this._responseQueue = [];
        this._responseResolvers = [];
        this._monitorMode = false;
    }

    /**
     * Check if Web Serial API is available.
     */
    static isSupported() {
        return 'serial' in navigator;
    }

    /**
     * Update state and emit event.
     */
    _setState(newState) {
        const oldState = this.state;
        this.state = newState;
        this.dispatchEvent(new CustomEvent('statechange', {
            detail: { oldState, newState }
        }));
    }

    /**
     * Request a serial port from the user.
     */
    async requestPort() {
        if (!SerialManager.isSupported()) {
            throw new Error('Web Serial API is not supported in this browser. Please use Chrome or another Chromium-based browser.');
        }

        try {
            this.port = await navigator.serial.requestPort({
                // Filter for known ESP USB devices
                filters: [
                    { usbVendorId: 0x10C4 }, // Silicon Labs CP2102
                    { usbVendorId: 0x1A86 }, // WCH CH340
                    { usbVendorId: 0x0403 }, // FTDI
                    { usbVendorId: 0x303A }, // Espressif native USB
                ]
            });
            return this.port;
        } catch (err) {
            if (err.name === 'NotFoundError') {
                // User cancelled — try without filters
                try {
                    this.port = await navigator.serial.requestPort();
                    return this.port;
                } catch (err2) {
                    throw new Error('No serial port selected.');
                }
            }
            throw err;
        }
    }

    /**
     * Open the serial port and set up read/write streams.
     */
    async connect(baudRate = 115200) {
        if (!this.port) throw new Error('No port selected. Call requestPort() first.');

        this.baudRate = baudRate;
        this._setState(ConnectionState.CONNECTING);

        try {
            await this.port.open({ baudRate: this.baudRate });

            this.writer = this.port.writable.getWriter();
            this.slipDecoder.reset();
            this._readLoopActive = true;
            this._startReadLoop();

            this._setState(ConnectionState.SYNCING);
            return true;
        } catch (err) {
            this._setState(ConnectionState.ERROR);
            throw new Error(`Failed to open port: ${err.message}`);
        }
    }

    /**
     * Internal read loop — continuously reads from the serial port.
     */
    async _startReadLoop() {
        const decoder = new TextDecoder();

        while (this._readLoopActive && this.port?.readable) {
            try {
                this.reader = this.port.readable.getReader();

                while (this._readLoopActive) {
                    const { value, done } = await this.reader.read();
                    if (done) break;

                    if (value && value.length > 0) {
                        if (this._monitorMode) {
                            // In monitor mode, emit raw text data
                            const text = decoder.decode(value, { stream: true });
                            this.dispatchEvent(new CustomEvent('monitordata', {
                                detail: { raw: value, text }
                            }));
                        } else {
                            // In command mode, process SLIP packets
                            const packets = this.slipDecoder.process(value);
                            for (const packet of packets) {
                                this._handlePacket(packet);
                            }
                        }
                    }
                }
            } catch (err) {
                if (this._readLoopActive) {
                    this.dispatchEvent(new CustomEvent('error', {
                        detail: { message: `Read error: ${err.message}` }
                    }));
                }
            } finally {
                if (this.reader) {
                    try { this.reader.releaseLock(); } catch { }
                    this.reader = null;
                }
            }
        }
    }

    /**
     * Handle a decoded SLIP packet.
     */
    _handlePacket(packet) {
        // Check for OHAI stub loader response
        if (packet.length === 4 &&
            packet[0] === 0x4F && packet[1] === 0x48 &&
            packet[2] === 0x41 && packet[3] === 0x49) {
            this.dispatchEvent(new CustomEvent('stubrunning'));
            return;
        }

        // Parse as response and resolve waiting promise
        const response = parseResponse(packet);
        this.dispatchEvent(new CustomEvent('response', { detail: response }));

        if (this._responseResolvers.length > 0) {
            const resolve = this._responseResolvers.shift();
            resolve(packet);
        } else {
            this._responseQueue.push(packet);
        }
    }

    /**
     * Send raw bytes to the serial port.
     */
    async sendRaw(data) {
        if (!this.writer) throw new Error('Port not connected');
        await this.writer.write(data);
    }

    /**
     * Send a SLIP-encoded command and wait for response.
     * @param {Uint8Array} slipPacket - Already SLIP-encoded packet
     * @param {number} timeout - Timeout in ms
     * @returns {Uint8Array} Raw response packet
     */
    async sendCommand(slipPacket, timeout = 3000) {
        await this.sendRaw(slipPacket);

        // Wait for response
        return new Promise((resolve, reject) => {
            // Check if there's already a queued response
            if (this._responseQueue.length > 0) {
                resolve(this._responseQueue.shift());
                return;
            }

            const timer = setTimeout(() => {
                // Remove this resolver
                const idx = this._responseResolvers.indexOf(resolverFn);
                if (idx >= 0) this._responseResolvers.splice(idx, 1);
                reject(new Error('Command timeout'));
            }, timeout);

            const resolverFn = (packet) => {
                clearTimeout(timer);
                resolve(packet);
            };

            this._responseResolvers.push(resolverFn);
        });
    }

    /**
     * Switch to serial monitor mode (raw text output).
     */
    async enterMonitorMode(baudRate = 115200) {
        // If baud rate differs, close and reopen
        if (this.baudRate !== baudRate) {
            await this.disconnect();
            await sleep(200);
            await this.connect(baudRate);
        }
        this._monitorMode = true;
        this._setState(ConnectionState.MONITORING);
    }

    /**
     * Switch back to command mode (SLIP protocol).
     */
    exitMonitorMode() {
        this._monitorMode = false;
        this.slipDecoder.reset();
        this._setState(ConnectionState.CONNECTED);
    }

    /**
     * Send text data in monitor mode.
     */
    async sendMonitorText(text) {
        const encoder = new TextEncoder();
        await this.sendRaw(encoder.encode(text));
    }

    /**
     * Toggle DTR/RTS signals for boot mode entry.
     */
    async setSignals(signals) {
        if (!this.port) throw new Error('Port not connected');
        await this.port.setSignals(signals);
    }

    /**
     * Get port info (VID/PID).
     */
    getPortInfo() {
        if (!this.port) return null;
        return this.port.getInfo();
    }

    /**
     * Disconnect and clean up.
     */
    async disconnect() {
        this._readLoopActive = false;
        this._monitorMode = false;

        try {
            if (this.reader) {
                await this.reader.cancel().catch(() => { });
                this.reader.releaseLock();
                this.reader = null;
            }
        } catch { }

        try {
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
        } catch { }

        try {
            if (this.port) {
                await this.port.close();
            }
        } catch { }

        this.port = null;
        this.slipDecoder.reset();
        this._responseQueue = [];
        this._responseResolvers.forEach(r => r(null));
        this._responseResolvers = [];
        this._setState(ConnectionState.DISCONNECTED);
    }

    /**
     * Check if currently connected.
     */
    get isConnected() {
        return this.state !== ConnectionState.DISCONNECTED &&
            this.state !== ConnectionState.ERROR;
    }
}

export { SerialManager, ConnectionState };
