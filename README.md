# ESP Flasher

A browser-based tool for flashing firmware and monitoring ESP32 boards — no software installation or drivers required.

## What is ESP Flasher?

ESP Flasher lets you flash `.bin` firmware files onto ESP32 development boards and monitor their serial output, all from your web browser. It works with both original Espressif boards and clone boards using common USB-UART bridges like CP2102, CH340, and FTDI.

## Supported Boards

- **ESP32** (all variants)
- **ESP32-S2** (Native USB)
- **ESP32-S3** (Native USB)
- **ESP32-C3** (USB-JTAG / Native USB)
- **ESP32-C6** (USB-JTAG)
- Clone boards with **CP2102**, **CH340**, **FTDI**, or **PL2303** bridges

## How to Use

### 1. Open the Tool

Open `index.html` in **Google Chrome** or **Microsoft Edge** (any Chromium-based browser that supports Web Serial API). You can serve it locally using any HTTP server:

```
npx serve .
```

Or simply open it with Live Server in VS Code.

### 2. Connect Your Board

1. Plug your ESP32 board into a USB port.
2. Click the **Connect** button in the top-left corner.
3. A browser dialog will appear — select your board's serial port (e.g., `CP2102 USB to UART Bridge`).
4. The tool will automatically detect your board and display its chip info in the left sidebar.

### 3. Flash Firmware

1. In the **Flash Firmware** section on the left sidebar, drag and drop a `.bin` file or click to browse.
2. Set the **flash address** (default is `0x0` — this works for most cases).
3. Click the **Flash** button.
4. The terminal will show flashing progress in real-time.

### 4. Serial Monitor

Once connected, the **Terminal** area in the center shows all serial output from your board in real-time. You can:

- **Send commands** using the input bar at the bottom (supports ASCII, HEX, and BIN formats).
- **Search** through terminal output using the built-in search bar.
- **Auto-scroll** to follow new output or pause to inspect older messages.
- **Timestamps** can be toggled on/off.
- **Clear** the terminal with the trash icon.
- **Repeat send** — enable the Repeat toggle to auto-send a command at a set interval.

### 5. Serial Settings

Use the settings bar at the top to configure:

- **Baud Rate** — 115200 (default), 9600, 57600, etc.
- **Data Bits** — 8 (default)
- **Parity** — None (default)
- **Stop Bits** — 1 (default)
- **Flow Control** — None (default)

### 6. Device Info

The left sidebar shows detected device information:

| Field        | Description                           |
|-------------|---------------------------------------|
| Chip         | Chip family and revision              |
| Architecture | Xtensa or RISC-V                      |
| Cores        | Number of CPU cores                   |
| MAC          | Hardware MAC address                  |
| Flash        | Flash memory size                     |
| USB Bridge   | USB-to-serial chip (CP2102, CH340...) |
| VID:PID      | USB Vendor and Product IDs            |

### 7. Export Data

Click the **Export** button (download icon in the header) to save your terminal session as a text file.

## Browser Requirements

| Browser         | Supported |
|-----------------|-----------|
| Google Chrome   | ✅         |
| Microsoft Edge  | ✅         |
| Opera           | ✅         |
| Firefox         | ❌         |
| Safari          | ❌         |

> Web Serial API is required. Only Chromium-based browsers support it.

## Tips

- **Auto-detection works best** when the board has a proper auto-reset circuit (most dev boards do).
- **Clone boards** — If auto-reset doesn't work, hold the **BOOT** button on your board while clicking Connect.
- **Native USB boards** (ESP32-S2/S3/C3) — The chip is identified instantly from USB descriptors without needing bootloader mode.
- **Dark/Light mode** — Toggle the theme using the moon/sun icon in the top-right corner.

## Author

**Bharani Dharan Rangaraj**
