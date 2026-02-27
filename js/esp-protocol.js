/**
 * ESP ROM Bootloader Protocol Engine
 * SLIP framing + ROM bootloader commands (non-module, attaches to window.ESPProtocol)
 */

(function () {
    const SLIP_END = 0xC0;
    const SLIP_ESC = 0xDB;
    const SLIP_ESC_END = 0xDC;
    const SLIP_ESC_ESC = 0xDD;
    const ESP_CHECKSUM_MAGIC = 0xEF;
    const FLASH_SECTOR_SIZE = 0x1000;

    const CMD = {
        FLASH_BEGIN: 0x02, FLASH_DATA: 0x03, FLASH_END: 0x04,
        MEM_BEGIN: 0x05, MEM_END: 0x06, MEM_DATA: 0x07,
        SYNC: 0x08, WRITE_REG: 0x09, READ_REG: 0x0A,
        SPI_SET_PARAMS: 0x0B, SPI_ATTACH: 0x0D, CHANGE_BAUDRATE: 0x0F,
    };

    function slipEncode(data) {
        const enc = [SLIP_END];
        for (const b of data) {
            if (b === SLIP_END) enc.push(SLIP_ESC, SLIP_ESC_END);
            else if (b === SLIP_ESC) enc.push(SLIP_ESC, SLIP_ESC_ESC);
            else enc.push(b);
        }
        enc.push(SLIP_END);
        return new Uint8Array(enc);
    }

    class SlipDecoder {
        constructor() { this.buffer = []; this.inEscape = false; }
        process(data) {
            const results = [];
            for (const b of data) {
                if (b === SLIP_END) {
                    if (this.buffer.length > 0) { results.push(new Uint8Array(this.buffer)); this.buffer = []; }
                    this.inEscape = false;
                } else if (this.inEscape) {
                    this.buffer.push(b === SLIP_ESC_END ? SLIP_END : b === SLIP_ESC_ESC ? SLIP_ESC : b);
                    this.inEscape = false;
                } else if (b === SLIP_ESC) { this.inEscape = true; }
                else { this.buffer.push(b); }
            }
            return results;
        }
        reset() { this.buffer = []; this.inEscape = false; }
    }

    function pack32LE(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
    function unpack32LE(d, o = 0) { return new DataView(d.buffer, d.byteOffset + o, 4).getUint32(0, true); }
    function pack16LE(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xFFFF, true); return b; }
    function calcChecksum(data) { let cs = ESP_CHECKSUM_MAGIC; for (const b of data) cs ^= b; return cs; }
    function concatU8(...arrs) {
        const r = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0));
        let o = 0; for (const a of arrs) { r.set(a, o); o += a.length; } return r;
    }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function buildCommand(cmdId, data = new Uint8Array(0), checksum = 0) {
        const h = new Uint8Array(8);
        h[0] = 0x00; h[1] = cmdId;
        const s = pack16LE(data.length); h[2] = s[0]; h[3] = s[1];
        const c = pack32LE(checksum); h[4] = c[0]; h[5] = c[1]; h[6] = c[2]; h[7] = c[3];
        return slipEncode(concatU8(h, data));
    }

    function parseResponse(pkt) {
        if (pkt.length < 8) return { valid: false };
        if (pkt[0] !== 0x01) return { valid: false };
        const cmd = pkt[1], size = pkt[2] | (pkt[3] << 8), value = unpack32LE(pkt, 4);
        const data = pkt.slice(8, 8 + size);
        let status = 0, errorCode = 0;
        if (data.length >= 2) { status = data[data.length - 2]; errorCode = data[data.length - 1]; }
        return { valid: true, command: cmd, size, value, data, status, errorCode, success: status === 0 };
    }

    function buildSyncCommand() {
        const d = new Uint8Array(36);
        d[0] = 0x07; d[1] = 0x07; d[2] = 0x12; d[3] = 0x20;
        for (let i = 4; i < 36; i++) d[i] = 0x55;
        return buildCommand(CMD.SYNC, d, 0);
    }

    function buildReadRegCommand(addr) { return buildCommand(CMD.READ_REG, pack32LE(addr), 0); }
    function buildWriteRegCommand(addr, value, mask = 0xFFFFFFFF, delayUs = 0) {
        return buildCommand(CMD.WRITE_REG, concatU8(pack32LE(addr), pack32LE(value), pack32LE(mask), pack32LE(delayUs)), 0);
    }

    function buildFlashBeginCommand(eraseSize, numPkts, pktSize, offset) {
        return buildCommand(CMD.FLASH_BEGIN, concatU8(pack32LE(eraseSize), pack32LE(numPkts), pack32LE(pktSize), pack32LE(offset)), 0);
    }

    function buildFlashDataCommand(body, seq) {
        const hdr = concatU8(pack32LE(body.length), pack32LE(seq), pack32LE(0), pack32LE(0));
        return buildCommand(CMD.FLASH_DATA, concatU8(hdr, body), calcChecksum(body));
    }

    function buildFlashEndCommand(reboot = false) { return buildCommand(CMD.FLASH_END, pack32LE(reboot ? 0 : 1), 0); }
    function buildSpiAttachCommand() { return buildCommand(CMD.SPI_ATTACH, concatU8(pack32LE(0), pack32LE(0)), 0); }

    // Classic Reset: exact match to esptool-js ClassicReset
    // DTR and RTS set SEPARATELY like esptool-js (critical for cheap bridges)
    // Sequence: "D0|R1|W100|D1|R0|W50|D0"
    async function classicReset(port, resetDelay = 50) {
        await port.setSignals({ dataTerminalReady: false }); // IO0 HIGH
        await port.setSignals({ requestToSend: true });       // EN LOW (reset)
        await sleep(100);
        await port.setSignals({ dataTerminalReady: true });   // IO0 LOW (boot select)
        await port.setSignals({ requestToSend: false });      // EN HIGH (exit reset → samples IO0 LOW → bootloader)
        await sleep(resetDelay);
        await port.setSignals({ dataTerminalReady: false });  // IO0 HIGH (release)
    }

    // USB-JTAG Reset: exact match to esptool-js UsbJtagSerialReset
    async function usbJtagReset(port) {
        await port.setSignals({ requestToSend: false });
        await port.setSignals({ dataTerminalReady: false });
        await sleep(100);
        await port.setSignals({ dataTerminalReady: true });
        await port.setSignals({ requestToSend: false });
        await sleep(100);
        await port.setSignals({ requestToSend: true });
        await port.setSignals({ dataTerminalReady: false });
        await port.setSignals({ requestToSend: true });
        await sleep(100);
        await port.setSignals({ requestToSend: false });
        await port.setSignals({ dataTerminalReady: false });
    }

    // Try multiple reset strategies, cycling through them on each attempt
    async function enterBootloader(port, attempt = 0) {
        let isNativeUsb = false;
        try {
            const info = port.getInfo();
            if (info.usbVendorId === 0x303A) {
                isNativeUsb = true;
            }
        } catch (e) { }

        if (isNativeUsb) {
            return await usbJtagReset(port);
        }

        // Cycle through different timing strategies for clone boards
        const strategy = attempt % 3;
        if (strategy === 0) {
            await classicReset(port, 50);   // Standard esptool timing
        } else if (strategy === 1) {
            await classicReset(port, 250);  // Longer delay for slow boards
        } else {
            await classicReset(port, 500);  // Extra long for very slow clones
        }
    }

    window.ESPProtocol = {
        CMD, SLIP_END, FLASH_SECTOR_SIZE,
        SlipDecoder, slipEncode, pack32LE, unpack32LE, calcChecksum, concatU8, sleep,
        buildCommand, parseResponse,
        buildSyncCommand, buildReadRegCommand, buildWriteRegCommand, buildFlashBeginCommand, buildFlashDataCommand, buildFlashEndCommand, buildSpiAttachCommand,
        enterBootloader,
    };
})();
