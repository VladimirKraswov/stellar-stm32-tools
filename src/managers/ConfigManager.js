const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

class ConfigManager {
  constructor(workspacePath, currentPlatform) {
    this.workspacePath = workspacePath;
    this.currentPlatform = currentPlatform;
    this.projectConfig = null;
    this.iocConfig = null;
    
    if (workspacePath) {
      this.loadConfig();
      this.loadIOCConfig();
    } else {
      this.projectConfig = this.getDefaultConfig();
    }
  }

  /**
   * Загружает конфигурацию проекта
   */
  loadConfig() {
    if (!this.workspacePath) {
      this.projectConfig = this.getDefaultConfig();
      return;
    }
    
    const configPath = path.join(this.workspacePath, '.stm32-config.json');
    const defaultConfig = this.getDefaultConfig();
    
    if (fs.existsSync(configPath)) {
      try {
        const parsedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.projectConfig = { ...defaultConfig, ...parsedConfig };
        console.log('Конфигурация загружена из .stm32-config.json');
      } catch (e) {
        console.error('Ошибка загрузки конфигурации:', e);
        this.projectConfig = defaultConfig;
      }
    } else {
      this.projectConfig = defaultConfig;
    }

    this.updateCppProperties();
  }

  /**
   * Загружает конфигурацию из .ioc файла
   */
  loadIOCConfig() {
    if (!this.workspacePath) return null;
    
    try {
      // Ищем .ioc файлы в рабочей директории
      const files = fs.readdirSync(this.workspacePath);
      const iocFiles = files.filter(f => f.endsWith('.ioc'));
      
      if (iocFiles.length === 0) {
        console.log('⚠ .ioc файл не найден в корне проекта');
        return null;
      }
      
      // Если несколько .ioc файлов, выбираем первый
      const iocFile = iocFiles[0];
      const iocPath = path.join(this.workspacePath, iocFile);
      
      console.log(`📄 Загружаем конфигурацию из .ioc файла: ${iocFile}`);
      const content = fs.readFileSync(iocPath, 'utf8');
      this.iocConfig = this.parseIOCFile(content);
      
      // Обновляем конфигурацию проекта на основе .ioc
      this.updateConfigFromIOC();
      
      console.log(`✅ Загружен контроллер из .ioc: ${this.iocConfig['Mcu.CPN'] || 'Неизвестный'}`);
      return this.iocConfig;
      
    } catch (error) {
      console.error(`❌ Ошибка загрузки .ioc файла: ${error.message}`);
      return null;
    }
  }

  /**
   * Парсит содержимое .ioc файла
   */
  parseIOCFile(content) {
    const config = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Пропускаем комментарии и пустые строки
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Парсим ключ=значение
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        config[key] = value;
      }
    }
    
    return config;
  }

  /**
   * Обновляет конфигурацию из .ioc файла
   */
  updateConfigFromIOC() {
    if (!this.iocConfig || !this.projectConfig) return;
    
    // Основная информация о контроллере
    if (this.iocConfig['Mcu.CPN']) {
      this.projectConfig.mcu = this.iocConfig['Mcu.CPN'];
    }
    
    if (this.iocConfig['Mcu.Name']) {
      this.projectConfig.mcuFamily = this.iocConfig['Mcu.Name'];
    }
    
    // Информация о линковщике
    if (this.iocConfig['ProjectManager.CompilerLinker']) {
      this.projectConfig.compilerLinker = this.iocConfig['ProjectManager.CompilerLinker'];
    }
    
    // Размеры памяти
    if (this.iocConfig['ProjectManager.StackSize']) {
      this.projectConfig.stackSize = this.iocConfig['ProjectManager.StackSize'];
    }
    
    if (this.iocConfig['ProjectManager.HeapSize']) {
      this.projectConfig.heapSize = this.iocConfig['ProjectManager.HeapSize'];
    }
    
    // Имя проекта
    if (this.iocConfig['ProjectManager.ProjectName']) {
      this.projectConfig.projectName = this.iocConfig['ProjectManager.ProjectName'];
    }
    
    // Настройки тактирования
    if (this.iocConfig['RCC.SYSCLKFreq_VALUE']) {
      this.projectConfig.sysClockFreq = this.iocConfig['RCC.SYSCLKFreq_VALUE'];
    }
    
    console.log('✅ Конфигурация обновлена из .ioc файла');
  }

  /**
   * Возвращает конфигурацию по умолчанию
   */
  getDefaultConfig() {
    let serialPortPattern;
    switch (this.currentPlatform) {
      case 'win32':
        serialPortPattern = 'COM*';
        break;
      case 'darwin':
        serialPortPattern = '/dev/tty*usb*'; // Изменено для лучшего захвата usbmodem
        break;
      case 'linux':
        serialPortPattern = '/dev/ttyUSB*';
        break;
      default:
        serialPortPattern = '/dev/ttyUSB*';
    }
    
    return {
      projectName: 'STM32F407VGT6',
      mcu: 'STM32F407VGTx',
      mcuFamily: 'STM32F4',
      compilerLinker: 'GCC',
      stackSize: '0x400',
      heapSize: '0x200',
      sysClockFreq: '8000000',
      serialPort: serialPortPattern,
      baudRate: 115200,
      programmerPath: this.getDefaultProgrammerPath(),
      gccPath: this.getDefaultGccPath(),
      sourceDirs: ['Core/Src', 'Drivers/STM32F4xx_HAL_Driver/Src'],
      excludeFiles: [],
      includeDirs: [
        "Core/Inc",
        "Drivers/STM32F4xx_HAL_Driver/Inc",
        "Drivers/CMSIS/Include",
        "Drivers/CMSIS/Device/ST/STM32F4xx/Include",
        "Drivers/STM32F4xx_HAL_Driver/Inc/Legacy",
      ],
      autoUpdateMakefile: true,
      preferredMonitor: 'auto',
      clearBufferOnStart: true,
      monitorTimeout: 3000,
      
      // Ключевые изменения: храним пути в конфиге
      ldscript: null,
      startupFile: null,
      ldscriptPath: null,
      startupFilePath: null,
      configInitialized: false
    };
  }

  /**
   * Возвращает путь к программеру по умолчанию
   */
  getDefaultProgrammerPath() {
    if (this.currentPlatform === 'darwin') {
      return '/Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/com.st.stm32cube.ide.mcu.externaltools.cubeprogrammer.macos64_2.2.300.202508131133/tools/bin/STM32_Programmer_CLI';
    } else if (this.currentPlatform === 'win32') {
      return 'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin\\STM32_Programmer_CLI.exe';
    } else {
      return '/usr/local/bin/STM32_Programmer_CLI';
    }
  }

  /**
   * Возвращает путь к компилятору GCC по умолчанию
   */
  getDefaultGccPath() {
    if (this.currentPlatform === 'darwin') {
      return '/Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.13.3.rel1.macos64_1.0.100.202509120712/tools/bin/arm-none-eabi-gcc';
    } else if (this.currentPlatform === 'win32') {
      return 'C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\10 2021.10\\bin\\arm-none-eabi-gcc.exe';
    } else {
      return '/usr/bin/arm-none-eabi-gcc';
    }
  }

  /**
   * Сохраняет конфигурацию проекта
   */
  saveConfig() {
    if (!this.workspacePath || !this.projectConfig) return false;
    
    const configPath = path.join(this.workspacePath, '.stm32-config.json');
    try {
      fs.writeFileSync(configPath, JSON.stringify(this.projectConfig, null, 2), 'utf8');
      console.log('Конфигурация сохранена в .stm32-config.json');
      
      // Перезагружаем конфиг сразу после сохранения
      this.loadConfig();
      
      // Обновляем c_cpp_properties.json
      this.updateCppProperties();
      
      return true;
    } catch (error) {
      console.error('Ошибка сохранения конфигурации:', error);
      vscode.window.showErrorMessage(`Ошибка сохранения конфигурации: ${error.message}`);
      return false;
    }
    
  }

  /**
   * Инициализирует конфигурацию (ищет линкер и стартап)
   */
  async initializeProjectConfig() {
    if (!this.workspacePath) return false;

    const projectConfig = this.projectConfig;
    
    // Ищем линкер
    if (!projectConfig.ldscriptPath) {
      const ldConfig = await this.findLinkerScript();
      if (ldConfig) {
        projectConfig.ldscript = ldConfig.ldscript;
        projectConfig.ldscriptPath = ldConfig.ldscriptPath;
      }
    }

    // Ищем стартап файл
    if (!projectConfig.startupFilePath) {
      const startupConfig = await this.findStartupFile();
      if (startupConfig) {
        projectConfig.startupFile = startupConfig.startupFile;
        projectConfig.startupFilePath = startupConfig.startupFilePath;
      }
    }

    projectConfig.configInitialized = true;
    return this.saveConfig();
  }

  /**
   * Ищет файл линкера в проекте
   */
  async findLinkerScript() {
    if (!this.workspacePath) return null;

    try {
      const patterns = [
        '**/*.ld',
        '**/*.LD',
        '**/STM32*_FLASH.ld',
        '**/*_FLASH.ld'
      ];

      let foundFiles = [];
      for (const pattern of patterns) {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
        foundFiles.push(...files.map(f => f.fsPath));
      }

      // Удаляем дубликаты
      foundFiles = [...new Set(foundFiles)];

      if (foundFiles.length === 0) {
        console.log('Файлы линкера не найдены');
        return null;
      }

      // Пробуем найти подходящий линкер на основе MCU
      const mcuName = this.projectConfig.mcu;
      let preferredLd = null;

      if (mcuName) {
        // Генерируем ожидаемое имя линкера
        const expectedLdName = this.getExpectedLinkerName(mcuName);
        
        // Ищем точное соответствие
        preferredLd = foundFiles.find(f => 
          path.basename(f) === expectedLdName ||
          f.includes(expectedLdName.replace('.ld', ''))
        );
      }

      // Если не нашли предпочтительный, берем первый
      const selectedLd = preferredLd || foundFiles[0];
      
      return {
        ldscript: path.basename(selectedLd),
        ldscriptPath: selectedLd,
        relativePath: path.relative(this.workspacePath, selectedLd)
      };
    } catch (error) {
      console.error('Ошибка поиска линкера:', error);
      return null;
    }
  }

  /**
   * Ищет стартап файл в проекте
   */
  async findStartupFile() {
    if (!this.workspacePath) return null;

    try {
      const mcuParams = this.getMCUParams(this.projectConfig.mcu);
      const startupFileName = `${mcuParams.startupFile}.s`;
      
      // Проверяем в стандартных местах
      const startupPaths = [
        path.join(this.workspacePath, startupFileName),
        path.join(this.workspacePath, 'Startup', startupFileName),
        path.join(this.workspacePath, 'startups', startupFileName),
        path.join(this.workspacePath, 'Core', 'Startup', startupFileName),
        path.join(this.workspacePath, 'Drivers', 'CMSIS', 'Device', 'ST', 
                 `STM32${mcuParams.series.toUpperCase()}xx`, 
                 'Source', 'Templates', 'gcc', startupFileName),
      ];

      // Ищем существующий файл
      for (const startupPath of startupPaths) {
        if (fs.existsSync(startupPath)) {
          const startupName = path.basename(startupPath, '.s').replace('.S', '');
          return {
            startupFile: startupName,
            startupFilePath: startupPath,
            relativePath: path.relative(this.workspacePath, startupPath)
          };
        }
      }

      // Ищем любой startup файл
      const searchPatterns = [
        '**/*startup*.s',
        '**/startup*.S',
        '**/startup_*.s',
        `**/startup_stm32${mcuParams.series}*.s`
      ];
      
      let allStartupFiles = [];
      for (const pattern of searchPatterns) {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
        allStartupFiles.push(...files.map(f => f.fsPath));
      }
      
      allStartupFiles = [...new Set(allStartupFiles)];

      if (allStartupFiles.length > 0) {
        // Пробуем найти подходящий файл
        const suitableFile = allStartupFiles.find(f => 
          f.includes(mcuParams.startupFile) || 
          f.includes(mcuParams.define.toLowerCase().replace('xx', ''))
        ) || allStartupFiles[0];

        const startupName = path.basename(suitableFile, '.s').replace('.S', '');
        return {
          startupFile: startupName,
          startupFilePath: suitableFile,
          relativePath: path.relative(this.workspacePath, suitableFile)
        };
      }

      console.log('Стартап файлы не найдены');
      return null;
    } catch (error) {
      console.error('Ошибка поиска стартап файла:', error);
      return null;
    }
  }

  /**
   * Генерирует ожидаемое имя линкера на основе MCU
   */
  getExpectedLinkerName(mcuName) {
    if (!mcuName) return 'STM32F407XX_FLASH.ld';
    
    // Пример: STM32F407VGT6 → STM32F407VG_FLASH.ld
    const baseName = mcuName.replace(/\d+$/, ''); // Убираем цифры в конце
    const variant = baseName.match(/STM32(F\d+[A-Z]*[A-Z])/);
    
    if (variant && variant[1]) {
      return `STM32${variant[1]}_FLASH.ld`;
    }
    
    return `${mcuName}_FLASH.ld`.replace(/\.\./g, '.');
  }

  /**
   * Получает параметры MCU для компилятора
   */
  getMCUParams(mcuName) {
    if (!mcuName) {
      mcuName = this.projectConfig?.mcu || 'STM32F407VG';
    }

    // Определяем параметры на основе конкретной модели MCU
    if (mcuName.includes('STM32F407')) {
      return {
        cpu: '-mcpu=cortex-m4',
        fpu: '-mfpu=fpv4-sp-d16',
        floatAbi: '-mfloat-abi=hard',
        startupFile: 'startup_stm32f407xx',
        define: 'STM32F407xx',
        series: 'f4'
      };
    } else if (mcuName.includes('STM32F401')) {
      return {
        cpu: '-mcpu=cortex-m4',
        fpu: '-mfpu=fpv4-sp-d16',
        floatAbi: '-mfloat-abi=hard',
        startupFile: 'startup_stm32f401xx',
        define: 'STM32F401xx',
        series: 'f4'
      };
    } else if (mcuName.includes('STM32F411')) {
      return {
        cpu: '-mcpu=cortex-m4',
        fpu: '-mfpu=fpv4-sp-d16',
        floatAbi: '-mfloat-abi=hard',
        startupFile: 'startup_stm32f411xe',
        define: 'STM32F411xE',
        series: 'f4'
      };
    } else if (mcuName.includes('STM32F103')) {
      return {
        cpu: '-mcpu=cortex-m3',
        fpu: '',
        floatAbi: '',
        startupFile: 'startup_stm32f103xe',
        define: 'STM32F103xE',
        series: 'f1'
      };
    } else if (mcuName.includes('STM32F303')) {
      return {
        cpu: '-mcpu=cortex-m4',
        fpu: '-mfpu=fpv4-sp-d16',
        floatAbi: '-mfloat-abi=hard',
        startupFile: 'startup_stm32f303xc',
        define: 'STM32F303xC',
        series: 'f3'
      };
    } else if (mcuName.includes('STM32F030')) {
      return {
        cpu: '-mcpu=cortex-m0',
        fpu: '',
        floatAbi: '',
        startupFile: 'startup_stm32f030x8',
        define: 'STM32F030x8',
        series: 'f0'
      };
    } else if (mcuName.includes('STM32G0')) {
      return {
        cpu: '-mcpu=cortex-m0plus',
        fpu: '',
        floatAbi: '',
        startupFile: 'startup_stm32g071xx',
        define: 'STM32G071xx',
        series: 'g0'
      };
    } else if (mcuName.includes('STM32L4')) {
      return {
        cpu: '-mcpu=cortex-m4',
        fpu: '-mfpu=fpv4-sp-d16',
        floatAbi: '-mfloat-abi=hard',
        startupFile: 'startup_stm32l476xx',
        define: 'STM32L476xx',
        series: 'l4'
      };
    } else if (mcuName.includes('STM32H7')) {
      return {
        cpu: '-mcpu=cortex-m7',
        fpu: '-mfpu=fpv5-d16',
        floatAbi: '-mfloat-abi=hard',
        startupFile: 'startup_stm32h750xx',
        define: 'STM32H750xx',
        series: 'h7'
      };
    }
    
    // По умолчанию для STM32F4
    return {
      cpu: '-mcpu=cortex-m4',
      fpu: '-mfpu=fpv4-sp-d16',
      floatAbi: '-mfloat-abi=hard',
      startupFile: 'startup_stm32f407xx',
      define: 'STM32F407xx',
      series: 'f4'
    };
  }

  /**
   * Получает информацию о проекте из .ioc файла
   */
  getIOCInfo() {
    if (!this.iocConfig) {
      return null;
    }
    
    return {
      mcu: this.iocConfig['Mcu.CPN'] || 'Не указан',
      family: this.iocConfig['Mcu.Name'] || 'Не указано',
      package: this.iocConfig['Mcu.Package'] || 'Не указан',
      projectName: this.iocConfig['ProjectManager.ProjectName'] || 'Не указан',
      compiler: this.iocConfig['ProjectManager.CompilerLinker'] || 'Не указан',
      stackSize: this.iocConfig['ProjectManager.StackSize'] || 'Не указан',
      heapSize: this.iocConfig['ProjectManager.HeapSize'] || 'Не указан',
      sysClockFreq: this.iocConfig['RCC.SYSCLKFreq_VALUE'] || 'Не указан',
      pinsCount: this.iocConfig['Mcu.PinsNb'] || '0',
      cubeVersion: this.iocConfig['MxCube.Version'] || 'Не указана'
    };
  }

  /**
   * Показывает информацию о проекте из .ioc файла
   */
  showIOCInfo() {
    const info = this.getIOCInfo();
    if (!info) {
      vscode.window.showInformationMessage('.ioc файл не найден или не загружен');
      return;
    }
    
    let infoText = '=== Информация о проекте из .ioc файла ===\n\n';
    infoText += `📟 Контроллер: ${info.mcu}\n`;
    infoText += `🏷️  Семейство: ${info.family}\n`;
    infoText += `📦 Корпус: ${info.package}\n`;
    infoText += `🔧 Компилятор: ${info.compiler}\n`;
    infoText += `📁 Проект: ${info.projectName}\n`;
    infoText += `📊 Стек: ${info.stackSize}\n`;
    infoText += `🗃️  Куча: ${info.heapSize}\n`;
    
    if (info.sysClockFreq !== 'Не указан') {
      const freq = parseInt(info.sysClockFreq);
      infoText += `⚡ Частота SYSCLK: ${(freq / 1000000).toFixed(2)} MHz\n`;
    }
    
    infoText += `📌 Пинов: ${info.pinsCount}\n`;
    infoText += `🛠️  STM32CubeMX версия: ${info.cubeVersion}\n`;
    
    vscode.window.showInformationMessage(infoText, { modal: true });
  }

  /**
   * Получает значение из конфигурации
   */
  get(key, defaultValue = null) {
    if (!this.projectConfig) return defaultValue;
    return this.projectConfig[key] || defaultValue;
  }

  /**
   * Устанавливает значение в конфигурации
   */
  set(key, value) {
    if (!this.projectConfig) return false;
    this.projectConfig[key] = value;
    return true;
  }

  /**
   * Сбрасывает конфигурацию к значениям по умолчанию
   */
  resetToDefaults() {
    this.projectConfig = this.getDefaultConfig();
    return this.saveConfig();
  }

  /**
   * Обновляет пути к инструментам
   */
  async updateToolPaths() {
    const config = this.projectConfig;
    
    const newGccPath = await vscode.window.showInputBox({
      prompt: 'Путь к arm-none-eabi-gcc',
      value: config.gccPath
    });
    
    if (newGccPath) {
      config.gccPath = newGccPath;
    }
    
    const newProgrammerPath = await vscode.window.showInputBox({
      prompt: 'Путь к STM32_Programmer_CLI',
      value: config.programmerPath
    });
    
    if (newProgrammerPath) {
      config.programmerPath = newProgrammerPath;
    }

    const serialPortInput = await vscode.window.showInputBox({
      prompt: 'Шаблон последовательного порта (например, /dev/tty.usb* или COM*)',
      value: config.serialPort
    });
    
    if (serialPortInput) {
      config.serialPort = serialPortInput;
    }

    const baudRateInput = await vscode.window.showInputBox({
      prompt: 'Скорость передачи (baud rate)',
      value: config.baudRate.toString(),
      validateInput: (value) => {
        if (!/^\d+$/.test(value)) return 'Должно быть число';
        return null;
      }
    });
    
    if (baudRateInput) {
      config.baudRate = parseInt(baudRateInput);
    }

    const result = this.saveConfig();
    if (result) {
      vscode.window.showInformationMessage('Пути к инструментам обновлены');
    }
  }

  /**
   * Перезагружает конфигурацию из .ioc файла
   */
  reloadIOCConfig() {
    console.log('Перезагрузка конфигурации из .ioc файла...');
    const oldMCU = this.projectConfig?.mcu;
    const oldProjectName = this.projectConfig?.projectName;
    
    this.loadIOCConfig();
    
    const newMCU = this.projectConfig?.mcu;
    const newProjectName = this.projectConfig?.projectName;
    
    if (oldMCU !== newMCU) {
      console.log(`MCU изменен: ${oldMCU} -> ${newMCU}`);
    }
    
    if (oldProjectName !== newProjectName) {
      console.log(`Имя проекта изменено: ${oldProjectName} -> ${newProjectName}`);
    }
    
    // Сохраняем обновленную конфигурацию
    this.saveConfig();
    
    return this.iocConfig !== null;
  }

  /**
   * Получает размеры памяти для конкретного контроллера
   */
  getMemorySizes(mcuName) {
    if (!mcuName) {
      mcuName = this.projectConfig?.mcu || 'STM32F407VG';
    }
    
    // Базовая конфигурация для STM32F407VG
    const defaultSizes = {
      flash: '1024K',
      ram: '192K',
      ccmram: '64K'
    };
    
    if (!mcuName) return defaultSizes;
    
    // Парсим размеры из названия контроллера
    const sizeMap = {
      'V': { flash: '1024K', ram: '192K' },  // 1MB Flash, 192KB RAM
      'Z': { flash: '1024K', ram: '256K' },  // 1MB Flash, 256KB RAM
      'I': { flash: '2048K', ram: '256K' },  // 2MB Flash, 256KB RAM
      'G': { flash: '512K', ram: '128K' },   // 512KB Flash, 128KB RAM
      'C': { flash: '256K', ram: '64K' },    // 256KB Flash, 64KB RAM
    };
    
    const memoryCode = mcuName.charAt(mcuName.length - 3);
    const sizes = sizeMap[memoryCode] || defaultSizes;
    
    // Определяем наличие CCMRAM на основе серии
    const series = this.getMCUParams(mcuName).series;
    const hasCCMRAM = series === 'F4' || series === 'F7' || series === 'H7';
    
    return {
      flash: sizes.flash,
      ram: sizes.ram,
      ccmram: hasCCMRAM ? '64K' : '0K'
    };
  }

  /**
   * Проверяет, загружена ли конфигурация
   */
  isConfigLoaded() {
    return this.projectConfig !== null;
  }

  /**
   * Проверяет, инициализирована ли конфигурация проекта
   */
  isProjectInitialized() {
    return this.projectConfig?.configInitialized || false;
  }

  /**
   * Получает конфигурацию проекта
   */
  getProjectConfig() {
    return this.projectConfig;
  }

  /**
   * Получает конфигурацию из .ioc файла
   */
  getIOCConfig() {
    return this.iocConfig;
  }

    // Метод для обновления c_cpp_properties.json
  async updateCppProperties() {
    if (!this.workspacePath) return;

    const vscodeDir = path.join(this.workspacePath, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }

    const cppPropertiesPath = path.join(vscodeDir, 'c_cpp_properties.json');

    // Собираем данные из конфига
    const includePaths = this.projectConfig.includeDirs || [];
    const defines = this.projectConfig.defines || ['USE_HAL_DRIVER', this.getMCUParams(this.projectConfig.mcu).define];

    // Базовая структура файла
    const cppConfig = {
      "configurations": [
        {
          "name": "STM32",
          "includePath": includePaths.map(p => `\${workspaceFolder}/${p}`),
          "defines": defines,
          "compilerPath": this.projectConfig.gccPath || "/usr/bin/arm-none-eabi-gcc",  // Берем из конфига или дефолт
          "cStandard": "c11",
          "cppStandard": "c++17",
          "intelliSenseMode": "gcc-arm",
          "browse": {
            "path": includePaths.map(p => `\${workspaceFolder}/${p}`),
            "limitSymbolsToIncludedHeaders": true
          }
        }
      ],
      "version": 4
    };

    // Читаем существующий файл, если есть, и мержим (чтобы не перезаписывать пользовательские изменения полностью)
    let existingConfig = {};
    if (fs.existsSync(cppPropertiesPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(cppPropertiesPath, 'utf8'));
        // Мержим: обновляем includePath и defines в первой конфигурации
        if (existingConfig.configurations && existingConfig.configurations.length > 0) {
          existingConfig.configurations[0].includePath = cppConfig.configurations[0].includePath;
          existingConfig.configurations[0].defines = cppConfig.configurations[0].defines;
          // Можно добавить мерж других полей, если нужно
        }
      } catch (e) {
        console.error('Ошибка чтения c_cpp_properties.json:', e);
      }
    } else {
      existingConfig = cppConfig;  // Если файла нет, создаем новый
    }

    // Записываем
    try {
      fs.writeFileSync(cppPropertiesPath, JSON.stringify(existingConfig, null, 2));
      console.log('c_cpp_properties.json обновлен');
      vscode.window.showInformationMessage('IntelliSense конфигурация обновлена (c_cpp_properties.json)');
    } catch (error) {
      console.error('Ошибка записи c_cpp_properties.json:', error);
      vscode.window.showErrorMessage(`Ошибка обновления IntelliSense: ${error.message}`);
    }
  }
}
module.exports = ConfigManager;