## Features

- **Project Setup Wizard** - Easy project configuration
- **Tree View Interface** - Organized task categories like PlatformIO
- **JavaScript-based Build System** - No bash scripts required
- **Automatic File Management** - Post-build processing in JS
- **Tool Checking** - Verify installed development tools
- **Device Management** - List connected STM32 devices
- **Serial Monitor** - Built-in serial communication
- **Debug Configuration** - Ready-to-use debug settings

## Usage

1. Install the extension
2. Open your STM32 project folder
3. Click on the STM32 icon in the Activity Bar (left sidebar)
4. Use the tree view to run commands:
   - **General**: Setup, configuration
   - **Project Tasks**: Build, clean, upload
   - **Debug**: Start debugging, generate files
   - **Device**: Check tools, list devices

## Configuration

The extension creates:
- `.stm32-platform.json` - Project configuration
- `.vscode/` - VS Code configuration files
- `.vscode/post-build.js` - JavaScript post-build script

## Requirements

- STM32CubeIDE (for ARM GCC and Programmer CLI)
- Make
- Screen (for serial monitor)

## Platform Support

- macOS (tested)
- Linux (should work)
- Windows (with adjustments)

## License

MIT