/**
 * ESP Device Detection & Hardware Info
 * Comprehensive chip database covering all ESP8266/ESP32 families and variants.
 * Uses magic register + EFUSE-based variant identification (like esptool.py).
 */
(function () {
    const P = window.ESPProtocol;
    const CHIP_DETECT_MAGIC_REG = 0x40001000;

    // ─── Complete Magic Value → Chip Family Map ───
    // Every known chip family magic value (from esptool.py source)
    const CHIP_MAP = {
        // ESP8266
        0xFFF0C101: { family: 'ESP8266', arch: 'Xtensa LX106', cores: 1, maxFreq: '160 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi 802.11 b/g/n'], macBase: 0x3FF00050, efuseBase: null },

        // ESP32 — classic (all package variants share this magic)
        0x00F01D83: { family: 'ESP32', arch: 'Xtensa LX6', cores: 2, maxFreq: '240 MHz', bootloaderOffset: '0x1000', features: ['Wi-Fi', 'BT', 'Dual Core'], macBase: 0x3FF5A004, efuseBase: 0x3FF5A000 },

        // ESP32-S2
        0x000007C6: { family: 'ESP32-S2', arch: 'Xtensa LX7', cores: 1, maxFreq: '240 MHz', bootloaderOffset: '0x1000', features: ['Wi-Fi'], macBase: 0x3F41A004, efuseBase: 0x3F41A000 },

        // ESP32-S3 (multiple known magic values)
        0x00000009: { family: 'ESP32-S3', arch: 'Xtensa LX7', cores: 2, maxFreq: '240 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi', 'BT 5.0', 'BLE', 'Dual Core'], macBase: 0x60007044, efuseBase: 0x60007000 },
        0x00000010: { family: 'ESP32-S3', arch: 'Xtensa LX7', cores: 2, maxFreq: '240 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi', 'BT 5.0', 'BLE', 'Dual Core'], macBase: 0x60007044, efuseBase: 0x60007000 },

        // ESP32-C3 (multiple known magic values — ECO revisions + ROM variants)
        0x6921506F: { family: 'ESP32-C3', arch: 'RISC-V', cores: 1, maxFreq: '160 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi', 'BT 5.0', 'BLE'], macBase: 0x60008844, efuseBase: 0x60008800 },
        0x1B31506F: { family: 'ESP32-C3', arch: 'RISC-V', cores: 1, maxFreq: '160 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi', 'BT 5.0', 'BLE'], macBase: 0x60008844, efuseBase: 0x60008800 },
        0x20120707: { family: 'ESP32-C3', arch: 'RISC-V', cores: 1, maxFreq: '160 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi', 'BT 5.0', 'BLE'], macBase: 0x60008844, efuseBase: 0x60008800 },

        // ESP32-C2 / ESP8684
        0x6F51306F: { family: 'ESP32-C2', arch: 'RISC-V', cores: 1, maxFreq: '120 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi', 'BLE'], macBase: 0x60008840, efuseBase: 0x60008800 },

        // ESP32-C6
        0x2CE0806F: { family: 'ESP32-C6', arch: 'RISC-V', cores: 1, maxFreq: '160 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi 6', 'BT 5.0', 'Zigbee', 'Thread'], macBase: 0x600B0844, efuseBase: 0x600B0800 },
        0x7C002270: { family: 'ESP32-C6', arch: 'RISC-V', cores: 1, maxFreq: '160 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi 6', 'BT 5.0', 'Zigbee', 'Thread'], macBase: 0x600B0844, efuseBase: 0x600B0800 },

        // ESP32-H2
        0xD7B73E80: { family: 'ESP32-H2', arch: 'RISC-V', cores: 1, maxFreq: '96 MHz', bootloaderOffset: '0x0', features: ['BT 5.0', 'Zigbee', 'Thread'], macBase: 0x600B0844, efuseBase: 0x600B0800 },
        0x332726E6: { family: 'ESP32-H2', arch: 'RISC-V', cores: 1, maxFreq: '96 MHz', bootloaderOffset: '0x0', features: ['BT 5.0', 'Zigbee', 'Thread'], macBase: 0x600B0844, efuseBase: 0x600B0800 },

        // ESP32-C5
        0x1101406F: { family: 'ESP32-C5', arch: 'RISC-V', cores: 1, maxFreq: '240 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi 6', 'BT 5.0', 'BLE'], macBase: 0x600B0844, efuseBase: 0x600B0800 },
        0x1502406F: { family: 'ESP32-C5', arch: 'RISC-V', cores: 1, maxFreq: '240 MHz', bootloaderOffset: '0x0', features: ['Wi-Fi 6', 'BT 5.0', 'BLE'], macBase: 0x600B0844, efuseBase: 0x600B0800 },

        // ESP32-P4
        0x0: { family: 'ESP32-P4', arch: 'RISC-V', cores: 2, maxFreq: '400 MHz', bootloaderOffset: '0x2000', features: ['Dual Core HP+LP'], macBase: 0, efuseBase: null },
    };

    // ─── ESP32 Package Variant Names (from EFUSE) ───
    const ESP32_PKG_NAMES = {
        0: 'ESP32-D0WDQ6', 1: 'ESP32-D0WD', 2: 'ESP32-D2WD',
        3: 'ESP32-PICO-V3', 4: 'ESP32-U4WDH', 5: 'ESP32-PICO-V3-02',
        6: 'ESP32-D0WDR2-V3',
    };

    // ─── Flash Manufacturer IDs ───
    const FLASH_MFR = {
        0xEF: 'Winbond', 0xC8: 'GigaDevice', 0x68: 'Boya', 0x20: 'XMC/Micron',
        0x01: 'Spansion', 0x1F: 'Adesto', 0xBF: 'SST', 0x9D: 'ISSI',
        0xC2: 'Macronix', 0x85: 'Puya', 0x0B: 'XTX', 0x5E: 'Zbit',
        0xA1: 'Fudan Micro', 0xF8: 'FM', 0x25: 'ZB', 0x51: 'Zetta',
        0xBA: 'Zetta', 0x4A: 'UBM', 0x1C: 'EON', 0x37: 'AMIC',
    };

    const FLASH_SIZES = {
        0x12: '256 KB', 0x13: '512 KB', 0x14: '1 MB', 0x15: '2 MB',
        0x16: '4 MB', 0x17: '8 MB', 0x18: '16 MB', 0x19: '32 MB',
        0x1A: '64 MB', 0x20: '64 MB', 0x21: '128 MB',
    };

    // ─── USB Bridge VID:PID Database ───
    const USB_BRIDGES = {
        '10C4:EA60': 'CP2102/CP2102N', '10C4:EA70': 'CP2105', '10C4:EA80': 'CP2108',
        '1A86:7523': 'CH340', '1A86:55D4': 'CH9102', '1A86:55D3': 'CH9102F',
        '0403:6001': 'FT232R', '0403:6010': 'FT2232', '0403:6015': 'FT-X',
        '0403:6014': 'FT232H', '0403:6011': 'FT4232',
        '303A:1001': 'Espressif Native USB', '303A:1002': 'Espressif Native USB',
        '303A:4001': 'Espressif USB-JTAG', '303A:4002': 'Espressif USB-JTAG',
        '303A:0002': 'Espressif Native USB', '303A:0003': 'Espressif Native USB',
        '2341:0043': 'Arduino (ATmega16U2)', '2341:0001': 'Arduino Uno',
        '067B:2303': 'PL2303', '1A86:5524': 'CH341A',
    };

    // VID-based fallback: if magic unknown but VID is Espressif (0x303A)
    const ESPRESSIF_VID = 0x303A;

    // ─── PID → Chip Family Inference (works without bootloader) ───
    // Espressif native USB PIDs reliably identify the chip family
    const ESPRESSIF_PID_MAP = {
        0x0002: { family: 'ESP32-S2', arch: 'Xtensa LX7', cores: 1, features: ['Wi-Fi', 'Native USB'] },
        0x0003: { family: 'ESP32-S2', arch: 'Xtensa LX7', cores: 1, features: ['Wi-Fi', 'Native USB'] },
        0x1001: { family: 'ESP32-S3 / ESP32-C3', arch: 'RISC-V or Xtensa LX7', cores: '1–2', features: ['Wi-Fi', 'BLE', 'Native USB'] },
        0x1002: { family: 'ESP32-S3', arch: 'Xtensa LX7', cores: 2, features: ['Wi-Fi', 'BT 5.0', 'Native USB'] },
        0x4001: { family: 'ESP32-C3', arch: 'RISC-V', cores: 1, features: ['Wi-Fi', 'BLE', 'USB-JTAG'] },
        0x4002: { family: 'ESP32-C3', arch: 'RISC-V', cores: 1, features: ['Wi-Fi', 'BLE', 'USB-JTAG'] },
        0x8001: { family: 'ESP32-C6', arch: 'RISC-V', cores: 1, features: ['Wi-Fi 6', 'BLE', 'Thread', 'Zigbee'] },
        0x8002: { family: 'ESP32-C6', arch: 'RISC-V', cores: 1, features: ['Wi-Fi 6', 'BLE', 'Thread', 'Zigbee'] },
    };

    // USB-UART bridge VIDs that indicate "some ESP board behind the bridge"
    const UART_BRIDGE_VIDS = [0x10C4, 0x1A86, 0x0403, 0x067B]; // CP210x, CH340, FTDI, PL2303

    class ESPDeviceDetector {
        constructor(sendFn) { this.send = sendFn; this.chip = null; }

        async readReg(addr) {
            // Try multiple times — stale SYNC responses may be in buffer
            for (let attempt = 0; attempt < 5; attempt++) {
                const resp = await this.send(P.buildReadRegCommand(addr));
                if (!resp) throw new Error('No response from register read');
                const p = P.parseResponse(resp);
                if (!p.valid) continue; // skip garbage
                // Verify this is actually a READ_REG response (cmd 0x0A), not a stale SYNC (0x08)
                if (p.command === 0x0A) {
                    if (p.status !== 0) throw new Error(`Register read error (status ${p.status})`);
                    return p.value;
                }
                // Got a response for a different command (likely stale SYNC) — try again
            }
            throw new Error(`No valid READ_REG response for 0x${addr.toString(16)} after retries`);
        }

        // Try reading a register, return null on failure instead of throwing
        async tryReadReg(addr) {
            try { return await this.readReg(addr); } catch { return null; }
        }

        async detectChip() {
            let magic = null;
            try { magic = await this.readReg(CHIP_DETECT_MAGIC_REG); } catch (e) {
                this.chip = { detected: false, name: 'Unknown', magic: 'Read Error' };
                return this.chip;
            }

            const magicU32 = magic >>> 0;
            const magicHex = '0x' + magicU32.toString(16).toUpperCase().padStart(8, '0');
            const info = CHIP_MAP[magicU32];

            if (!info) {
                // Unknown magic — still report what we got
                // If we got a response at all, the bootloader is running, just unknown ROM magic
                this.chip = { detected: false, name: `Unknown (${magicHex})`, magic: magicHex, arch: 'Unknown', cores: '?', features: [] };
                return this.chip;
            }

            this.chip = { ...info, magic: magicHex, detected: true, name: info.family };

            // For ESP32, try to read EFUSE for variant name (D0WD, D0WDQ6, PICO, etc.)
            if (info.family === 'ESP32') {
                await this._identifyESP32Variant();
            }

            return this.chip;
        }

        async _identifyESP32Variant() {
            try {
                // ESP32 EFUSE block layout:
                // EFUSE_BLK0_RDATA3 (0x3FF5A00C): bits[20]=major_rev, bits[15:8]=pkg_version_low, bits[7:0]=minor_rev
                // EFUSE_BLK0_RDATA5 (0x3FF5A014): APB_CONTROLLER_DATE_REG for additional version info
                const efuse3 = await this.readReg(0x3FF5A00C);
                const efuse5 = await this.readReg(0x3FF5A014);

                // Package version: bits[11:9] from efuse3
                let pkgVer = (efuse3 >> 9) & 0x07;
                // Some newer ESP32 revisions use additional bits from other EFUSE registers
                const apbDate = await this.tryReadReg(0x3FF6607C);
                if (apbDate !== null) {
                    // ESP32-V3 detection (APB_CTRL_DATE_REG >= 2019_08_01)
                    const extraPkgVer = (apbDate >> 0) & 0x0F;
                    if (extraPkgVer > 0 && pkgVer < 4) {
                        // Use the combined version
                    }
                }

                // Chip revision
                const majorRev = (efuse3 >> 20) & 0x01;
                const minorRev = (efuse3 >> 8) & 0x07;
                // Check ECO version from EFUSE5
                const ecoVer = (efuse5 >> 20) & 0x07;
                let revision = majorRev * 100 + minorRev;
                if (ecoVer > minorRev) revision = majorRev * 100 + ecoVer;
                this.chip._revision = revision;

                const pkgName = ESP32_PKG_NAMES[pkgVer];
                if (pkgName) {
                    this.chip.name = pkgName;
                } else {
                    this.chip.name = `ESP32 (pkg ${pkgVer})`;
                }

                // Single vs dual core detection
                const efuse4 = await this.tryReadReg(0x3FF5A010);
                if (efuse4 !== null) {
                    const disableAppCpu = (efuse4 >> 0) & 0x01;
                    if (disableAppCpu) {
                        this.chip.cores = 1;
                        this.chip.features = this.chip.features.filter(f => f !== 'Dual Core');
                        this.chip.features.push('Single Core');
                    }
                }
            } catch (e) {
                // Keep the generic ESP32 name if EFUSE reads fail
            }
        }

        async readMacAddress() {
            if (!this.chip?.detected) return 'N/A';
            try {
                if (this.chip.family === 'ESP8266') {
                    const w0 = await this.readReg(this.chip.macBase);
                    const w1 = await this.readReg(this.chip.macBase + 4);
                    const mac = [(w1 >> 16) & 0xFF, (w1 >> 8) & 0xFF, w1 & 0xFF,
                    (w0 >> 16) & 0xFF, (w0 >> 8) & 0xFF, w0 & 0xFF];
                    return mac.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
                }
                // ESP32, ESP32-S2, ESP32-S3, ESP32-C3, etc.
                const w1 = await this.readReg(this.chip.macBase);
                const w2 = await this.readReg(this.chip.macBase + 4);
                const mac = [(w2 >> 8) & 0xFF, w2 & 0xFF,
                (w1 >> 24) & 0xFF, (w1 >> 16) & 0xFF, (w1 >> 8) & 0xFF, w1 & 0xFF];
                return mac.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
            } catch { return 'Read Error'; }
        }

        async readCrystalFreq() {
            if (!this.chip?.detected) return 'N/A';
            if (this.chip.family === 'ESP32') {
                try {
                    const div = await this.readReg(0x3FF40014);
                    const d = div & 0xFFFFF;
                    if (d > 0) { const f = Math.round((d * 115200) / 1e6); return f >= 33 ? '40 MHz' : '26 MHz'; }
                } catch { }
                return '40 MHz';
            }
            if (this.chip.family === 'ESP8266') return '26 MHz';
            if (this.chip.family === 'ESP32-H2') return '32 MHz';
            return '40 MHz';
        }

        async readChipRevision() {
            if (!this.chip?.detected) return 'N/A';
            try {
                if (this.chip.family === 'ESP32') {
                    // Use the revision from EFUSE if we already computed it
                    if (this.chip._revision !== undefined) {
                        const major = Math.floor(this.chip._revision / 100);
                        const minor = this.chip._revision % 100;
                        return `${major}.${minor}`;
                    }
                    const r = await this.readReg(0x3FF5A00C);
                    const major = (r >> 20) & 1;
                    const minor = (r >> 8) & 7;
                    return `${major}.${minor}`;
                }
                if (this.chip.family === 'ESP32-S2') {
                    const r = await this.readReg(0x3F41A004 + 0x10);
                    return `0.${(r >> 18) & 7}`;
                }
                if (this.chip.family === 'ESP32-S3') {
                    const r = await this.readReg(0x60007044 + 0x10);
                    return `0.${(r >> 18) & 7}`;
                }
                if (this.chip.family === 'ESP32-C3') {
                    const r = await this.readReg(0x60008848);
                    return `0.${(r >> 18) & 7}`;
                }
                if (this.chip.family === 'ESP32-C2') {
                    const r = await this.readReg(0x60008840 + 8);
                    return `0.${(r >> 18) & 7}`;
                }
                if (this.chip.family === 'ESP32-C6') {
                    const r = await this.readReg(0x600B0844 + 8);
                    return `0.${(r >> 18) & 7}`;
                }
            } catch { }
            return '0';
        }

        async readFlashId() {
            if (!this.chip?.detected) return { raw: 'N/A', manufacturer: 'Unknown', size: 'Unknown' };
            try {
                // Attach SPI flash
                if (P.buildSpiAttachCommand) {
                    await this.send(P.buildSpiAttachCommand());
                    await P.sleep(100);
                }

                // SPI register bases differ per chip family
                const isESP32 = this.chip.family === 'ESP32';
                const spiBase = isESP32 ? 0x3FF42000 : 0x60002000;
                const SPI_USR = spiBase + 0x1C;
                const SPI_USR1 = spiBase + 0x20;
                const SPI_USR2 = spiBase + 0x24;
                const SPI_W0 = spiBase + 0x80;
                const SPI_CMD = spiBase + 0x00;

                // Configure SPI for RDID (0x9F): 8-bit command, 24-bit response
                if (P.buildWriteRegCommand) {
                    await this.send(P.buildWriteRegCommand(SPI_USR, (1 << 31) | (1 << 27)));
                    await P.sleep(10);
                    await this.send(P.buildWriteRegCommand(SPI_USR1, (23 << 0)));
                    await P.sleep(10);
                    await this.send(P.buildWriteRegCommand(SPI_USR2, (7 << 28) | 0x9F));
                    await P.sleep(10);
                    await this.send(P.buildWriteRegCommand(SPI_CMD, 1 << 18));
                    await P.sleep(100);
                }

                const jedec = await this.readReg(SPI_W0);
                const mfId = jedec & 0xFF;
                const devId = (jedec >> 8) & 0xFF;
                const sizeCode = (jedec >> 16) & 0xFF;
                return {
                    raw: '0x' + (jedec >>> 0).toString(16).toUpperCase().padStart(6, '0'),
                    manufacturer: FLASH_MFR[mfId] || `Unknown (0x${mfId.toString(16).toUpperCase()})`,
                    size: FLASH_SIZES[sizeCode] || `Unknown (0x${sizeCode.toString(16)})`,
                };
            } catch (e) {
                return { raw: 'Error', manufacturer: 'Unknown', size: 'Unknown' };
            }
        }

        /**
         * Infer chip info purely from USB VID/PID (no bootloader needed).
         * Returns { chip, bridge, vidPid, needsBootloader }
         */
        static detectChipFromUSB(port) {
            try {
                const info = port.getInfo();
                if (info.usbVendorId === undefined) {
                    return { chip: null, bridge: 'Unknown', vidPid: 'N/A', needsBootloader: true };
                }

                const vid = info.usbVendorId;
                const pid = info.usbProductId;
                const vidHex = vid.toString(16).toUpperCase().padStart(4, '0');
                const pidHex = pid.toString(16).toUpperCase().padStart(4, '0');
                const vidPid = `VID 0x${vidHex} / PID 0x${pidHex}`;
                const bridgeKey = `${vidHex}:${pidHex}`;
                const bridge = USB_BRIDGES[bridgeKey] || `Unknown (${bridgeKey})`;

                // Espressif native USB — can identify chip from PID
                if (vid === ESPRESSIF_VID) {
                    const chipInfo = ESPRESSIF_PID_MAP[pid];
                    if (chipInfo) {
                        return {
                            chip: { ...chipInfo, detected: true, name: chipInfo.family },
                            bridge, vidPid, needsBootloader: false
                        };
                    }
                    // Unknown Espressif PID
                    return {
                        chip: { family: 'Espressif Device', arch: 'Unknown', cores: '?', detected: false },
                        bridge, vidPid, needsBootloader: true
                    };
                }

                // USB-UART bridge — cannot identify chip without bootloader
                if (UART_BRIDGE_VIDS.includes(vid)) {
                    return {
                        chip: { family: 'ESP Board (via ' + bridge + ')', arch: 'Needs bootloader', cores: '?', detected: false },
                        bridge, vidPid, needsBootloader: true
                    };
                }

                return { chip: null, bridge, vidPid, needsBootloader: true };
            } catch {
                return { chip: null, bridge: 'Unknown', vidPid: 'N/A', needsBootloader: true };
            }
        }

        static detectUSBBridge(port) {
            try {
                const info = port.getInfo();
                if (info.usbVendorId === undefined) return { vidPid: 'N/A', bridge: 'Unknown' };
                const vid = info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
                const pid = info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
                const key = `${vid}:${pid}`;
                return { vidPid: `VID 0x${vid} / PID 0x${pid}`, bridge: USB_BRIDGES[key] || `Unknown Bridge (${key})` };
            } catch { return { vidPid: 'N/A', bridge: 'Unknown' }; }
        }

        async getFullInfo(port) {
            const chip = await this.detectChip();
            // Run sequentially — they share the same serial port
            const revision = await this.readChipRevision();
            const crystal = await this.readCrystalFreq();
            const mac = await this.readMacAddress();
            const flash = await this.readFlashId();
            const usb = ESPDeviceDetector.detectUSBBridge(port);
            return { chip, revision, crystal, mac, flash, usb };
        }
    }

    window.ESPDeviceDetector = ESPDeviceDetector;
})();
