/**
 * App — Unified controller for ESP Flasher + Serial Monitor
 * Bridges the Serial Monitor modules (Terminal, Plotter, Search, Stats, Export)
 * with ESP Flasher features (chip detection, firmware flashing).
 *
 * Auto-detects device on successful connection.
 * Connection settings presented via modal popup.
 */
const App = {
    connected: false,
    repeatInterval: null,
    espDetector: null,
    flashFile: null,

    // ======= Init =======
    init() {
        this._setupThemeToggle();
        this._setupSerialManager();
        Terminal.init();
        Search.init();
        Stats.init();
        Export.init();
        this._setupModals();
        this._setupConnectionUI();
        this._setupSendBar();
        this._setupCollapsibles();
        this._setupFlashPanel();
        this._setupKeyboardShortcuts();

        if (!('serial' in navigator)) {
            this._setBadge('disconnected', 'No Web Serial');
            document.getElementById('btn-open-connect').disabled = true;
        }
    },

    // ======= Theme Toggle =======
    _setupThemeToggle() {
        const btn = document.getElementById('btn-theme-toggle');
        const sunIcon = document.getElementById('icon-sun');
        const moonIcon = document.getElementById('icon-moon');
        const saved = localStorage.getItem('esp-flasher-theme');

        // Apply saved theme or default to light
        if (saved === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            sunIcon.style.display = '';
            moonIcon.style.display = 'none';
        }

        btn.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                sunIcon.style.display = 'none';
                moonIcon.style.display = '';
                localStorage.setItem('esp-flasher-theme', 'light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                sunIcon.style.display = '';
                moonIcon.style.display = 'none';
                localStorage.setItem('esp-flasher-theme', 'dark');
            }
        });
    },

    // ======= Serial Manager =======
    _setupSerialManager() {
        const SM = window.SerialManager;
        SM.onData = (channelId, entry, decoded) => this._onSerialData(channelId, entry, decoded);
        SM.onStatus = (channelId, statusObj) => this._updateConnectionStatus(channelId, statusObj);
        SM.onError = (channelId, error) => this._onSerialError(channelId, error);
        SM.onPortsUpdated = (ports) => this._onPortsUpdated(ports);
        SM.init();
    },

    _onSerialData(channelId, entry, decoded) {
        Terminal.addLine(entry);
        Stats.incrementRx(new TextEncoder().encode(entry.data || '').length, true);
        if (decoded && decoded.length > 0 && window.ProtocolViewer) {
            ProtocolViewer.addDecoded(decoded);
        }
    },

    _onSerialError(channelId, error) {
        Stats.incrementErrors();
        Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `ERROR: ${error}` });
    },

    _onPortsUpdated(ports) {
        const select = document.getElementById('port-select');
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Select Port --</option>';
        ports.forEach((p) => {
            const label = p.vid !== undefined
                ? `USB (VID:${p.vid?.toString(16).toUpperCase()} PID:${p.pid?.toString(16).toUpperCase()})`
                : `Port ${p.id}`;
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = label;
            select.appendChild(opt);
        });
        if (currentVal) select.value = currentVal;
    },

    // ======= Modals =======
    _setupModals() {
        // Close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.modal;
                document.getElementById(id).style.display = 'none';
            });
        });

        // Click outside to close
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.style.display = 'none';
            });
        });

        // Open connect modal
        document.getElementById('btn-open-connect').addEventListener('click', () => {
            document.getElementById('modal-connect').style.display = 'flex';
        });

        // Export button
        document.getElementById('btn-export').addEventListener('click', () => {
            document.getElementById('modal-export').style.display = 'flex';
        });
    },

    // ======= Connection =======
    _setupConnectionUI() {
        document.getElementById('btn-request-port').addEventListener('click', () => this._requestPort());
        document.getElementById('btn-connect').addEventListener('click', () => this._connect());
        document.getElementById('btn-disconnect').addEventListener('click', () => this._disconnect());
    },

    async _requestPort() {
        await window.SerialManager.requestNewPort();
    },

    async _connect() {
        try {
            const portSelect = document.getElementById('port-select');
            const selected = portSelect.value;

            let portRef = null;

            if (selected && selected.startsWith('port-')) {
                // Lookup port by index from authorized ports
                const ports = await navigator.serial.getPorts();
                const portIndex = parseInt(selected.replace('port-', ''));
                if (!isNaN(portIndex) && portIndex >= 0 && portIndex < ports.length) {
                    portRef = ports[portIndex];
                }
            }

            if (!portRef) {
                // No valid port selected — prompt user to pick one
                try {
                    portRef = await navigator.serial.requestPort();
                } catch (e) {
                    Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Port selection cancelled.' });
                    return;
                }
            }

            await this._connectToPort(portRef);
        } catch (e) {
            console.error('Connect error:', e);
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Connection error: ${e.message}` });
        }
    },

    async _connectToPort(portRef) {
        try {
            const baudRate = parseInt(document.getElementById('baud-rate').value) || 115200;
            const dataBits = parseInt(document.getElementById('data-bits').value) || 8;
            const stopBits = parseInt(document.getElementById('stop-bits').value) || 1;
            const parity = document.getElementById('parity').value || 'none';
            const flowControl = document.getElementById('flow-control').value || 'none';

            const config = { portRef, baudRate, dataBits, stopBits, parity, flowControl };
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Connecting at ${baudRate} baud...` });

            const ok = await window.SerialManager.connect('main', config);
            if (ok) {
                this.connected = true;
                Stats.setConnectedAt(Date.now());

                // Close modal
                document.getElementById('modal-connect').style.display = 'none';

                // Auto-detect device
                setTimeout(() => this._autoDetectDevice(), 500);
            } else {
                Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Connection failed. Check device and try again.' });
            }
        } catch (e) {
            console.error('_connectToPort error:', e);
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Connection error: ${e.message}` });
        }
    },

    async _disconnect() {
        await window.SerialManager.disconnect('main');
        this.connected = false;
        Stats.reset();
        this._resetDeviceInfo();
        document.getElementById('btn-flash').disabled = true;
    },

    _updateConnectionStatus(channelId, msg) {
        const btnConnect = document.getElementById('btn-open-connect');
        const btnDisconnect = document.getElementById('btn-disconnect');

        if (msg.status === 'connected') {
            this._setBadge('connected', 'Connected');
            btnConnect.style.display = 'none';
            btnDisconnect.style.display = '';
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Connected at ${msg.config?.baudRate || 115200} baud` });
        } else if (msg.status === 'disconnected') {
            this._setBadge('disconnected', 'Disconnected');
            btnConnect.style.display = '';
            btnDisconnect.style.display = 'none';
            this.connected = false;
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Disconnected' });
        }
    },

    _setBadge(type, label) {
        const badge = document.getElementById('connection-badge');
        badge.className = `badge badge-${type}`;
        document.getElementById('connection-label').textContent = label;
    },

    // ======= Auto-Detect =======
    _setDetectBadge(state, text) {
        const badge = document.getElementById('detect-status');
        badge.className = 'detect-badge ' + state;
        badge.textContent = text;
    },

    _resetDeviceInfo() {
        const ids = ['info-chip-name', 'info-chip-arch', 'info-chip-cores',
            'info-mac-address', 'info-flash-size', 'info-usb-bridge', 'info-usb-vidpid'];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
        this._setDetectBadge('', 'Not Connected');
    },

    async _autoDetectDevice() {
        if (!this.connected) return;

        const P = window.ESPProtocol;
        this._setDetectBadge('detecting', 'Detecting...');
        Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Auto-detecting device...' });

        let connData = null;
        let port = null;

        try {
            connData = window.SerialManager.ports.get('main');
            if (!connData) throw new Error('Not connected');
            port = connData.port;

            // ═══ TIER 1: USB-based detection (instant, always works) ═══
            const usbInfo = window.ESPDeviceDetector.detectChipFromUSB(port);

            // Show USB info immediately
            document.getElementById('info-usb-bridge').textContent = usbInfo.bridge || '--';
            document.getElementById('info-usb-vidpid').textContent = usbInfo.vidPid || '--';

            if (usbInfo.chip) {
                document.getElementById('info-chip-name').textContent = usbInfo.chip.name || usbInfo.chip.family || '--';
                document.getElementById('info-chip-arch').textContent = usbInfo.chip.arch || '--';
                document.getElementById('info-chip-cores').textContent = usbInfo.chip.cores
                    ? `${usbInfo.chip.cores} (${usbInfo.chip.cores > 1 ? 'Dual' : 'Single'})`
                    : '--';

                Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `USB detected: ${usbInfo.chip.family} | ${usbInfo.chip.arch}` });

                if (usbInfo.chip.features && usbInfo.chip.features.length > 0) {
                    Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Features: ${usbInfo.chip.features.join(', ')}` });
                }
            }

            // Even if USB identified the chip, still try bootloader for full details (MAC, flash, revision)

            // ═══ TIER 2: Bootloader-based detection (needs download mode) ═══
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Attempting bootloader detection for full chip details...' });

            // Stop the monitor read loop so we can do direct SLIP communication
            connData.keepReading = false;
            if (connData.reader) {
                try { await connData.reader.cancel(); } catch (e) { }
            }
            await P.sleep(200);

            const slipDecoder = new P.SlipDecoder();

            // Helper: drain any stale data from the serial buffer
            const drainBuffer = async () => {
                try {
                    const r = port.readable.getReader();
                    const deadline = Date.now() + 200;
                    try {
                        while (Date.now() < deadline) {
                            const result = await Promise.race([
                                r.read(),
                                P.sleep(100).then(() => ({ timeout: true }))
                            ]);
                            if (result.timeout || result.done) break;
                        }
                    } catch (e) { }
                    r.releaseLock();
                } catch (e) { }
            };

            // Helper: send a SLIP packet and wait for response with timeout
            const directSend = async (packet, timeoutMs = 1000) => {
                const writer = port.writable.getWriter();
                try { await writer.write(packet); } finally { writer.releaseLock(); }

                const reader = port.readable.getReader();
                const deadline = Date.now() + timeoutMs;
                try {
                    while (Date.now() < deadline) {
                        const result = await Promise.race([
                            reader.read(),
                            P.sleep(timeoutMs).then(() => ({ timeout: true }))
                        ]);
                        if (result.timeout || result.done) break;
                        if (result.value) {
                            const packets = slipDecoder.process(result.value);
                            if (packets.length > 0) {
                                reader.releaseLock();
                                return packets[0];
                            }
                        }
                    }
                    reader.releaseLock();
                    return null;
                } catch (e) {
                    try { reader.releaseLock(); } catch (ex) { }
                    return null;
                }
            };

            let synced = false;
            const MAX_BOOT_ATTEMPTS = 6;
            const SYNC_RETRIES_PER_BOOT = 5;

            // Quick SYNC without reset (in case already in bootloader)
            await drainBuffer();
            slipDecoder.reset();
            for (let s = 0; s < 3 && !synced; s++) {
                slipDecoder.reset();
                const resp = await directSend(P.buildSyncCommand(), 300);
                if (resp) {
                    const parsed = P.parseResponse(resp);
                    if (parsed.valid && parsed.command === 0x08) {
                        synced = true;
                        // Drain extra SYNC responses
                        for (let d = 0; d < 7; d++) { slipDecoder.reset(); await directSend(P.buildSyncCommand(), 100); }
                        // Critical: drain the read buffer to clear ALL stale responses
                        slipDecoder.reset();
                        await drainBuffer();
                        break;
                    }
                }
                await P.sleep(50);
            }

            if (!synced) {
                // Hardware reset attempts
                for (let boot = 0; boot < MAX_BOOT_ATTEMPTS && !synced; boot++) {
                    Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Boot attempt ${boot + 1}/${MAX_BOOT_ATTEMPTS}...` });
                    await P.enterBootloader(port, boot);
                    await drainBuffer();
                    slipDecoder.reset();

                    for (let s = 0; s < SYNC_RETRIES_PER_BOOT && !synced; s++) {
                        slipDecoder.reset();
                        const resp = await directSend(P.buildSyncCommand(), 500);
                        if (resp) {
                            const parsed = P.parseResponse(resp);
                            if (parsed.valid && parsed.command === 0x08) {
                                synced = true;
                                // Drain extra SYNC responses
                                for (let d = 0; d < 7; d++) { slipDecoder.reset(); await directSend(P.buildSyncCommand(), 100); }
                                // Critical: drain the buffer before register reads
                                slipDecoder.reset();
                                await drainBuffer();
                                break;
                            }
                        }
                        await P.sleep(50);
                    }
                }
            }

            if (!synced) {
                // Bootloader detection failed — but USB info is already shown
                if (usbInfo.chip) {
                    this._setDetectBadge('detected', 'USB Detected');
                    Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Bootloader sync failed. Showing USB-inferred info only.' });
                    Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Tip: Hold BOOT button and reconnect for full details (MAC, flash size, exact chip revision).' });
                    document.getElementById('info-mac-address').textContent = 'Needs bootloader';
                    document.getElementById('info-flash-size').textContent = 'Needs bootloader';
                } else {
                    this._setDetectBadge('error', 'Sync Failed');
                    Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Could not sync with bootloader.' });
                    Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Tip: Hold BOOT button, then click Connect.' });
                }
                connData.keepReading = true;
                window.SerialManager._startReadLoop('main');
                return;
            }

            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Bootloader synced! Reading chip registers...' });

            // Full bootloader-based detection
            const detector = new window.ESPDeviceDetector(directSend);
            const info = await detector.getFullInfo(port);

            const chip = info.chip || {};
            const chipName = chip.detected
                ? `${chip.name}${info.revision ? ' (rev ' + info.revision.replace('v', '') + ')' : ''}`
                : chip.name || 'Unknown';

            document.getElementById('info-chip-name').textContent = chipName;
            document.getElementById('info-chip-arch').textContent = chip.arch || '--';
            document.getElementById('info-chip-cores').textContent = chip.cores ? `${chip.cores} (${chip.cores > 1 ? 'Dual' : 'Single'})` : '--';
            document.getElementById('info-mac-address').textContent = info.mac || '--';
            document.getElementById('info-flash-size').textContent = info.flash?.size || '?';

            this._setDetectBadge('detected', 'Detected');
            this.espDetector = detector;
            if (this.flashFile) document.getElementById('btn-flash').disabled = false;

            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Detected: ${chipName} | ${chip.arch || '?'}, ${chip.cores || '?'} cores` });
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `MAC: ${info.mac || 'N/A'} | Flash: ${info.flash?.size || '?'} (${info.flash?.manufacturer || 'Unknown'})` });

            // Restart monitor read loop
            connData.keepReading = true;
            window.SerialManager._startReadLoop('main');

        } catch (e) {
            this._setDetectBadge('error', 'Detection Failed');
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Detection error: ${e.message}` });
            if (connData) {
                connData.keepReading = true;
                window.SerialManager._startReadLoop('main');
            }
        }
    },

    // ======= Flash Firmware =======
    _setupFlashPanel() {
        const fileInput = document.getElementById('flash-file');
        const label = document.getElementById('flash-file-label');
        const btnFlash = document.getElementById('btn-flash');

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.flashFile = file;
                label.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
                label.classList.remove('muted');
                if (this.connected && this.espDetector) btnFlash.disabled = false;
            }
        });

        btnFlash.addEventListener('click', () => this._flashFirmware());
    },

    async _flashFirmware() {
        if (!this.flashFile || !this.connected) return;
        const P = window.ESPProtocol;
        const btn = document.getElementById('btn-flash');
        const progressDiv = document.getElementById('flash-progress');
        const progressBar = document.getElementById('flash-progress-bar');
        const progressText = document.getElementById('flash-progress-text');

        btn.disabled = true;
        progressDiv.style.display = '';

        try {
            const connData = window.SerialManager.ports.get('main');
            if (!connData) throw new Error('Not connected');
            const port = connData.port;
            const slipDecoder = new P.SlipDecoder();

            connData.keepReading = false;
            if (connData.reader) {
                try { await connData.reader.cancel(); } catch (e) { }
            }
            await P.sleep(100);

            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Starting firmware flash...' });
            await P.enterBootloader(port);
            await P.sleep(200);

            const directSend = async (packet) => {
                const writer = port.writable.getWriter();
                try { await writer.write(packet); } finally { writer.releaseLock(); }
                const reader = port.readable.getReader();
                const deadline = Date.now() + 10000;
                try {
                    while (Date.now() < deadline) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        const packets = slipDecoder.process(value);
                        if (packets.length > 0) { reader.releaseLock(); return packets[0]; }
                    }
                    reader.releaseLock(); return null;
                } catch (e) { try { reader.releaseLock(); } catch (ex) { } return null; }
            };

            let synced = false;
            for (let i = 0; i < 5; i++) {
                slipDecoder.reset();
                const r = await directSend(P.buildSyncCommand());
                if (r && P.parseResponse(r).valid) { synced = true; break; }
                await P.sleep(100);
            }

            if (!synced) throw new Error('Failed to sync with bootloader');
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Bootloader synced' });

            const firmware = new Uint8Array(await this.flashFile.arrayBuffer());
            const offset = parseInt(document.getElementById('flash-address').value) || 0;
            const blockSize = 0x4000;
            const numBlocks = Math.ceil(firmware.length / blockSize);
            const eraseSize = firmware.length;

            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Flashing ${firmware.length} bytes at 0x${offset.toString(16)} (${numBlocks} blocks)` });

            const beginResp = await directSend(P.buildFlashBeginCommand(eraseSize, numBlocks, blockSize, offset));
            if (!beginResp || !P.parseResponse(beginResp).success) throw new Error('FLASH_BEGIN failed');

            for (let seq = 0; seq < numBlocks; seq++) {
                const start = seq * blockSize;
                let block = firmware.slice(start, start + blockSize);
                if (block.length < blockSize) {
                    const padded = new Uint8Array(blockSize);
                    padded.fill(0xFF);
                    padded.set(block);
                    block = padded;
                }

                slipDecoder.reset();
                const dataResp = await directSend(P.buildFlashDataCommand(block, seq));
                if (!dataResp) throw new Error(`FLASH_DATA failed at block ${seq}`);

                const pct = Math.round(((seq + 1) / numBlocks) * 100);
                progressBar.style.width = pct + '%';
                progressText.textContent = `${pct}% (${seq + 1}/${numBlocks})`;
            }

            await directSend(P.buildFlashEndCommand(true));
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: 'Flash complete. Device rebooting...' });
            progressText.textContent = '100% -- Done';

            connData.keepReading = true;
            window.SerialManager._startReadLoop('main');

        } catch (e) {
            Terminal.addLine({ timestamp: Date.now(), direction: 'rx', data: `Flash error: ${e.message}` });
            const connData = window.SerialManager.ports.get('main');
            if (connData) {
                connData.keepReading = true;
                window.SerialManager._startReadLoop('main');
            }
        }

        btn.disabled = false;
    },

    // ======= Send Bar =======
    _setupSendBar() {
        const input = document.getElementById('send-input');
        const btnSend = document.getElementById('btn-send');
        const repeatCheckbox = document.getElementById('send-repeat');
        const repeatInterval = document.getElementById('send-repeat-interval');

        btnSend.addEventListener('click', () => this._sendData());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._sendData();
        });

        repeatCheckbox.addEventListener('change', (e) => {
            repeatInterval.style.display = e.target.checked ? '' : 'none';
            if (e.target.checked) {
                this._startRepeat();
            } else {
                clearInterval(this.repeatInterval);
                this.repeatInterval = null;
            }
        });
    },

    async _sendData() {
        const input = document.getElementById('send-input');
        const payload = input.value;
        if (!payload) return;

        const mode = document.querySelector('input[name="send-mode"]:checked')?.value || 'ascii';
        const ok = await window.SerialManager.send('main', payload, mode);
        if (ok) {
            Stats.incrementTx(new TextEncoder().encode(payload).length);
        }
    },

    _startRepeat() {
        clearInterval(this.repeatInterval);
        const ms = parseInt(document.getElementById('send-repeat-interval').value) || 1000;
        this.repeatInterval = setInterval(() => this._sendData(), ms);
    },

    // ======= Collapsibles =======
    _setupCollapsibles() {

        const statsHeader = document.getElementById('stats-collapse-header');
        const rightSidebar = document.getElementById('right-sidebar');
        if (statsHeader) {
            statsHeader.addEventListener('click', () => {
                rightSidebar.classList.toggle('collapsed');
            });
        }
    },



    // ======= Keyboard Shortcuts =======
    _setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                Terminal.clear();
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
