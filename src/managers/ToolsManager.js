// managers/ToolsManager.js
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execCommand, runInTerminal } = require('../utils');
const { exec } = require('child_process');

class ToolsManager {
  constructor(workspacePath, configManager, outputChannel) {
    this.workspacePath = workspacePath;
    this.configManager = configManager;
    this.outputChannel = outputChannel;
    this.currentPlatform = configManager.currentPlatform;
  }

  /**
   * Проверка всех инструментов разработки
   */
  async checkTools() {
    const terminal = await runInTerminal(
      '', 
      'Проверка инструментов', 
      this.workspacePath, 
      this.configManager.projectConfig, 
      this.outputChannel
    );
    
    this.outputChannel.clear();
    this.outputChannel.show();
    this.outputChannel.appendLine('=== Проверка инструментов STM32 разработки ===\n');
    
    const checks = [
      'echo "=== Инструменты STM32 разработки ==="',
      'echo ""',
      'echo "1. Системная информация:"',
      'uname -a 2>/dev/null || echo "Недоступно"',
      'echo ""',
      'echo "2. Платформа:"',
      `echo "${this.currentPlatform}"`,
      'echo ""',
      'echo "3. Утилита make:"',
      'make --version 2>/dev/null || echo "✗ make не установлен"',
      'echo ""',
      'echo "4. ARM GCC toolchain:"',
      'arm-none-eabi-gcc --version 2>/dev/null || echo "✗ ARM GCC не установлен"',
      'echo ""',
      'echo "5. STM32 Programmer:"',
      'STM32_Programmer_CLI --version 2>/dev/null || echo "✗ STM32 Programmer не установлен"',
      'echo ""',
      'echo "6. Python (для мониторинга последовательного порта):"',
      'python --version 2>/dev/null || python3 --version 2>/dev/null || echo "✗ Python не установлен"',
      'echo ""',
      'echo "7. pyserial (библиотека Python):"',
      'python3 -c "import serial; print(f\\"pyserial {serial.__version__}\\")" 2>/dev/null || python -c "import serial; print(f\\"pyserial {serial.__version__}\\")" 2>/dev/null || echo "✗ pyserial не установлен"',
      'echo ""',
      'echo "8. PuTTY (Windows, опционально):"',
      this.currentPlatform === 'win32' ? 'where putty 2>/dev/null || echo "✗ PuTTY не установлен (опционально)"' : 'echo "PuTTY не требуется на этой платформе"',
      'echo ""',
      'echo "=== Пути к инструментам ==="',
      'which make 2>/dev/null || echo "make: не найден"',
      'which arm-none-eabi-gcc 2>/dev/null || echo "arm-none-eabi-gcc: не найден"',
      'which STM32_Programmer_CLI 2>/dev/null || echo "STM32_Programmer_CLI: не найден"',
      'which python 2>/dev/null || which python3 2>/dev/null || echo "Python: не найден"',
      'echo ""',
      'echo "=== Версии инструментов ==="',
      'echo -n "make: " && make --version 2>/dev/null | head -1',
      'echo -n "ARM GCC: " && arm-none-eabi-gcc --version 2>/dev/null | head -1',
      'echo -n "STM32 Programmer: " && STM32_Programmer_CLI --version 2>/dev/null | head -1',
      'python --version 2>/dev/null || python3 --version 2>/dev/null || echo "Python: не доступен"',
      'echo ""',
      'echo "=== Проверка завершена ==="'
    ];
    
    checks.forEach(cmd => terminal.sendText(cmd));
    
    // Запускаем дополнительную проверку через Node.js
    await this.runAdvancedToolsCheck();
    
    return true;
  }

  /**
   * Расширенная проверка инструментов через Node.js
   */
  async runAdvancedToolsCheck() {
    this.outputChannel.appendLine('\n=== Расширенная проверка инструментов ===\n');
    
    // Проверяем make
    await this.checkMake();
    
    // Проверяем ARM GCC
    await this.checkArmGcc();
    
    // Проверяем STM32 Programmer
    await this.checkStm32Programmer();
    
    // Проверяем Python
    await this.checkPython();
    
    // Проверяем pyserial
    await this.checkPyserial();
    
    // Проверяем пути из конфигурации
    await this.checkConfiguredPaths();
    
    // Общая оценка
    await this.generateToolsReport();
  }

  /**
   * Проверка утилиты make
   */
  async checkMake() {
    try {
      const { execSync } = require('child_process');
      const result = execSync('make --version 2>/dev/null || echo "NOT_FOUND"', { encoding: 'utf8' });
      
      if (result.includes('NOT_FOUND')) {
        this.outputChannel.appendLine('❌ make: не установлен');
        return false;
      }
      
      const versionMatch = result.match(/(\d+\.\d+\.?\d*)/);
      const version = versionMatch ? versionMatch[0] : 'неизвестно';
      
      this.outputChannel.appendLine(`✅ make: установлен (версия ${version})`);
      return true;
    } catch (error) {
      this.outputChannel.appendLine(`❌ make: ошибка проверки - ${error.message}`);
      return false;
    }
  }

  /**
   * Проверка ARM GCC
   */
  async checkArmGcc() {
    const configPath = this.configManager.projectConfig.gccPath;
    let found = false;
    let version = 'неизвестно';
    
    // Проверяем по пути из конфигурации
    if (fs.existsSync(configPath)) {
      try {
        const { execSync } = require('child_process');
        const result = execSync(`"${configPath}" --version 2>&1 | head -1`, { encoding: 'utf8' });
        if (result && !result.includes('not found') && !result.includes('No such file')) {
          found = true;
          const versionMatch = result.match(/(\d+\.\d+\.?\d*)/);
          version = versionMatch ? versionMatch[0] : 'неизвестно';
          this.outputChannel.appendLine(`✅ ARM GCC: найден по пути ${configPath} (версия ${version})`);
        }
      } catch (error) {
        // Продолжаем проверку
      }
    }
    
    // Если не нашли по пути из конфигурации, проверяем в PATH
    if (!found) {
      try {
        const { execSync } = require('child_process');
        const result = execSync('arm-none-eabi-gcc --version 2>&1 | head -1', { encoding: 'utf8' });
        if (result && !result.includes('not found') && !result.includes('No such file')) {
          found = true;
          const versionMatch = result.match(/(\d+\.\d+\.?\d*)/);
          version = versionMatch ? versionMatch[0] : 'неизвестно';
          this.outputChannel.appendLine(`✅ ARM GCC: найден в PATH (версия ${version})`);
        }
      } catch (error) {
        // Не найден
      }
    }
    
    if (!found) {
      this.outputChannel.appendLine(`❌ ARM GCC: не найден`);
      
      // Предлагаем решения
      this.outputChannel.appendLine('   💡 Решения:');
      this.outputChannel.appendLine('   - Установите GNU Arm Embedded Toolchain');
      this.outputChannel.appendLine('   - Для Windows: https://developer.arm.com/downloads/-/gnu-rm');
      this.outputChannel.appendLine('   - Для macOS: brew install arm-none-eabi-gcc');
      this.outputChannel.appendLine('   - Для Linux: sudo apt-get install gcc-arm-none-eabi');
      this.outputChannel.appendLine('   - Или обновите путь в настройках расширения');
    }
    
    return found;
  }

  /**
   * Проверка STM32 Programmer
   */
  async checkStm32Programmer() {
    const configPath = this.configManager.projectConfig.programmerPath;
    let found = false;
    let version = 'неизвестно';
    
    // Проверяем по пути из конфигурации
    if (fs.existsSync(configPath)) {
      try {
        const { execSync } = require('child_process');
        const result = execSync(`"${configPath}" --version 2>&1`, { encoding: 'utf8' });
        if (result && result.includes('STM32CubeProgrammer')) {
          found = true;
          const versionMatch = result.match(/Version\s+(\d+\.\d+\.?\d*)/);
          version = versionMatch ? versionMatch[1] : 'неизвестно';
          this.outputChannel.appendLine(`✅ STM32 Programmer: найден по пути ${configPath} (версия ${version})`);
        }
      } catch (error) {
        // Продолжаем проверку
      }
    }
    
    // Если не нашли по пути из конфигурации, проверяем в PATH
    if (!found) {
      try {
        const { execSync } = require('child_process');
        const result = execSync('STM32_Programmer_CLI --version 2>&1', { encoding: 'utf8' });
        if (result && result.includes('STM32CubeProgrammer')) {
          found = true;
          const versionMatch = result.match(/Version\s+(\d+\.\d+\.?\d*)/);
          version = versionMatch ? versionMatch[1] : 'неизвестно';
          this.outputChannel.appendLine(`✅ STM32 Programmer: найден в PATH (версия ${version})`);
        }
      } catch (error) {
        // Не найден
      }
    }
    
    if (!found) {
      this.outputChannel.appendLine(`❌ STM32 Programmer: не найден`);
      
      // Предлагаем решения
      this.outputChannel.appendLine('   💡 Решения:');
      this.outputChannel.appendLine('   - Установите STM32CubeProgrammer');
      this.outputChannel.appendLine('   - Скачайте с https://www.st.com/en/development-tools/stm32cubeprog.html');
      this.outputChannel.appendLine('   - Для macOS: обычно устанавливается с STM32CubeIDE');
      this.outputChannel.appendLine('   - Для Windows: установите STM32CubeProgrammer отдельно');
      this.outputChannel.appendLine('   - Или обновите путь в настройках расширения');
    }
    
    return found;
  }

  /**
   * Проверка Python
   */
  async checkPython() {
    let found = false;
    let version = 'неизвестно';
    
    // Проверяем python3
    try {
      const { execSync } = require('child_process');
      const result = execSync('python3 --version 2>&1', { encoding: 'utf8' });
      if (result && result.startsWith('Python')) {
        found = true;
        const versionMatch = result.match(/(\d+\.\d+\.?\d*)/);
        version = versionMatch ? versionMatch[0] : 'неизвестно';
        this.outputChannel.appendLine(`✅ Python 3: найден (версия ${version})`);
      }
    } catch (error) {
      // Пробуем python
      try {
        const result = execSync('python --version 2>&1', { encoding: 'utf8' });
        if (result && result.startsWith('Python')) {
          found = true;
          const versionMatch = result.match(/(\d+\.\d+\.?\d*)/);
          version = versionMatch ? versionMatch[0] : 'неизвестно';
          this.outputChannel.appendLine(`✅ Python: найден (версия ${version})`);
        }
      } catch (error2) {
        // Не найден
      }
    }
    
    if (!found) {
      this.outputChannel.appendLine(`❌ Python: не найден`);
      
      // Предлагаем решения
      this.outputChannel.appendLine('   💡 Решения:');
      this.outputChannel.appendLine('   - Установите Python 3.6 или выше');
      this.outputChannel.appendLine('   - Скачайте с https://www.python.org/downloads/');
      this.outputChannel.appendLine('   - Для macOS: brew install python');
      this.outputChannel.appendLine('   - Для Linux: sudo apt-get install python3 python3-pip');
      this.outputChannel.appendLine('   - Для Windows: установите Python с официального сайта');
    }
    
    return found;
  }

  /**
   * Проверка pyserial
   */
  async checkPyserial() {
    let found = false;
    let version = 'неизвестно';
    
    // Проверяем через python3
    try {
      const { execSync } = require('child_process');
      const result = execSync('python3 -c "import serial; print(serial.__version__)" 2>&1', { encoding: 'utf8' });
      if (result && !result.includes('ModuleNotFoundError') && !result.includes('ImportError')) {
        found = true;
        version = result.trim();
        this.outputChannel.appendLine(`✅ pyserial: установлен (версия ${version})`);
      }
    } catch (error) {
      // Пробуем через python
      try {
        const result = execSync('python -c "import serial; print(serial.__version__)" 2>&1', { encoding: 'utf8' });
        if (result && !result.includes('ModuleNotFoundError') && !result.includes('ImportError')) {
          found = true;
          version = result.trim();
          this.outputChannel.appendLine(`✅ pyserial: установлен (версия ${version})`);
        }
      } catch (error2) {
        // Не найден
      }
    }
    
    if (!found) {
      this.outputChannel.appendLine(`❌ pyserial: не установлен`);
      
      // Предлагаем решения
      this.outputChannel.appendLine('   💡 Решения:');
      this.outputChannel.appendLine('   - Установите pyserial через pip:');
      this.outputChannel.appendLine('     pip install pyserial');
      this.outputChannel.appendLine('   - Или через pip3:');
      this.outputChannel.appendLine('     pip3 install pyserial');
      this.outputChannel.appendLine('   - Если нет прав, используйте:');
      this.outputChannel.appendLine('     pip install --user pyserial');
    }
    
    return found;
  }

  /**
   * Проверка путей из конфигурации
   */
  async checkConfiguredPaths() {
    this.outputChannel.appendLine('\n=== Проверка путей из конфигурации ===\n');
    
    const config = this.configManager.projectConfig;
    
    // Проверяем путь к GCC
    if (config.gccPath && fs.existsSync(config.gccPath)) {
      this.outputChannel.appendLine(`✅ Путь к ARM GCC корректен: ${config.gccPath}`);
    } else {
      this.outputChannel.appendLine(`❌ Путь к ARM GCC не существует: ${config.gccPath}`);
    }
    
    // Проверяем путь к программатору
    if (config.programmerPath && fs.existsSync(config.programmerPath)) {
      this.outputChannel.appendLine(`✅ Путь к STM32 Programmer корректен: ${config.programmerPath}`);
    } else {
      this.outputChannel.appendLine(`❌ Путь к STM32 Programmer не существует: ${config.programmerPath}`);
    }
    
    // Проверяем рабочий каталог
    if (this.workspacePath && fs.existsSync(this.workspacePath)) {
      this.outputChannel.appendLine(`✅ Рабочий каталог существует: ${this.workspacePath}`);
    } else {
      this.outputChannel.appendLine(`❌ Рабочий каталог не существует: ${this.workspacePath}`);
    }
  }

  /**
   * Генерация отчета о инструментах
   */
  async generateToolsReport() {
    this.outputChannel.appendLine('\n=== Сводный отчет ===\n');
    
    // Собираем результаты проверок
    const results = [];
    
    // Здесь можно было бы собрать результаты всех проверок
    // Для простоты просто выведем рекомендации
    
    const recommendations = [];
    
    // Проверяем наличие критических инструментов
    const criticalTools = [
      { name: 'make', check: await this.checkMake() },
      { name: 'ARM GCC', check: await this.checkArmGcc() },
      { name: 'STM32 Programmer', check: await this.checkStm32Programmer() }
    ];
    
    const missingCritical = criticalTools.filter(tool => !tool.check);
    
    if (missingCritical.length === 0) {
      this.outputChannel.appendLine('✅ Все критические инструменты установлены');
    } else {
      this.outputChannel.appendLine(`⚠ Отсутствуют критические инструменты: ${missingCritical.map(t => t.name).join(', ')}`);
      recommendations.push('Установите отсутствующие критические инструменты');
    }
    
    // Проверяем наличие опциональных инструментов
    const optionalTools = [
      { name: 'Python', check: await this.checkPython() },
      { name: 'pyserial', check: await this.checkPyserial() }
    ];
    
    const missingOptional = optionalTools.filter(tool => !tool.check);
    
    if (missingOptional.length === 0) {
      this.outputChannel.appendLine('✅ Все опциональные инструменты установлены');
    } else {
      this.outputChannel.appendLine(`⚠ Отсутствуют опциональные инструменты: ${missingOptional.map(t => t.name).join(', ')}`);
      recommendations.push('Для работы монитора порта установите Python и pyserial');
    }
    
    // Рекомендации по платформе
    switch (this.currentPlatform) {
      case 'win32':
        recommendations.push('На Windows убедитесь, что все инструменты добавлены в PATH');
        break;
      case 'darwin':
        recommendations.push('На macOS инструменты часто устанавливаются через Homebrew или STM32CubeIDE');
        break;
      case 'linux':
        recommendations.push('На Linux используйте менеджер пакетов (apt, yum, pacman) для установки инструментов');
        break;
    }
    
    if (recommendations.length > 0) {
      this.outputChannel.appendLine('\n💡 Рекомендации:');
      recommendations.forEach((rec, index) => {
        this.outputChannel.appendLine(`   ${index + 1}. ${rec}`);
      });
    }
    
    this.outputChannel.appendLine('\n=== Конец отчета ===');
  }

  /**
   * Открыть терминал для STM32 разработки
   */
  async openTerminal() {
    const terminal = vscode.window.createTerminal({
      name: 'STM32 Терминал',
      cwd: this.workspacePath
    });
    
    terminal.show();
    
    // Отправляем приветственное сообщение и полезные команды
    terminal.sendText('echo "=== Терминал STM32 разработки ==="');
    terminal.sendText(`echo "Проект: ${this.configManager.projectConfig.projectName || 'Не настроен'}"`);
    terminal.sendText(`echo "Платформа: ${this.currentPlatform}"`);
    terminal.sendText(`echo "Рабочий каталог: ${this.workspacePath || 'Не открыт'}"`);
    terminal.sendText('echo ""');
    terminal.sendText('echo "Доступные команды:"');
    terminal.sendText('echo "  make -j4           # Собрать проект"');
    terminal.sendText('echo "  make clean         # Очистить сборку"');
    terminal.sendText('echo "  make flash         # Прошить устройство (если цель flash в Makefile)"');
    terminal.sendText('echo "  ./post-build.sh    # Скопировать файлы в bin/ (если есть)"');
    terminal.sendText('echo ""');
    terminal.sendText('echo "Проверка инструментов:"');
    terminal.sendText('echo "  make --version"');
    terminal.sendText('echo "  arm-none-eabi-gcc --version"');
    terminal.sendText('echo "  STM32_Programmer_CLI --version"');
    terminal.sendText('echo "  python --version"');
    terminal.sendText('echo ""');
    terminal.sendText('echo "Мониторинг порта:"');
    terminal.sendText('echo "  python -m serial.tools.miniterm <port> <baudrate>"');
    terminal.sendText('echo ""');
    
    return terminal;
  }

  /**
   * Установка недостающих инструментов (полу-автоматическая)
   */
  async installMissingTools() {
    const choices = [
      'Установить ARM GCC',
      'Установить STM32CubeProgrammer',
      'Установить Python',
      'Установить pyserial',
      'Проверить все инструменты'
    ];
    
    const selected = await vscode.window.showQuickPick(
      choices,
      {
        placeHolder: 'Выберите инструмент для установки',
        matchOnDescription: true
      }
    );
    
    if (!selected) return;
    
    switch (selected) {
      case 'Установить ARM GCC':
        await this.installArmGcc();
        break;
      case 'Установить STM32CubeProgrammer':
        await this.installStm32Programmer();
        break;
      case 'Установить Python':
        await this.installPython();
        break;
      case 'Установить pyserial':
        await this.installPyserial();
        break;
      case 'Проверить все инструменты':
        await this.checkTools();
        break;
    }
  }

  /**
   * Установка ARM GCC (инструкции)
   */
  async installArmGcc() {
    let instructions = '';
    
    switch (this.currentPlatform) {
      case 'win32':
        instructions = 
          'Установка ARM GCC на Windows:\n\n' +
          '1. Скачайте GNU Arm Embedded Toolchain с https://developer.arm.com/downloads/-/gnu-rm\n' +
          '2. Запустите установщик и следуйте инструкциям\n' +
          '3. Добавьте путь к bin в переменную окружения PATH\n' +
          '   (обычно C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\<version>\\bin)\n' +
          '4. Перезапустите VS Code после установки\n';
        break;
      case 'darwin':
        instructions = 
          'Установка ARM GCC на macOS:\n\n' +
          '1. Установите Homebrew если еще не установлен:\n' +
          '   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n' +
          '2. Установите ARM GCC через Homebrew:\n' +
          '   brew install arm-none-eabi-gcc\n' +
          '3. Или установите через STM32CubeIDE\n';
        break;
      case 'linux':
        instructions = 
          'Установка ARM GCC на Linux:\n\n' +
          'Для Debian/Ubuntu:\n' +
          '  sudo apt-get update\n' +
          '  sudo apt-get install gcc-arm-none-eabi\n\n' +
          'Для Arch Linux:\n' +
          '  sudo pacman -S arm-none-eabi-gcc\n\n' +
          'Для Fedora:\n' +
          '  sudo dnf install arm-none-eabi-gcc-cs\n';
        break;
      default:
        instructions = 'Неизвестная платформа. Пожалуйста, установите ARM GCC вручную.';
    }
    
    vscode.window.showInformationMessage(instructions, { modal: true });
    this.outputChannel.appendLine(`\n${instructions}`);
    this.outputChannel.show();
  }

  /**
   * Установка STM32CubeProgrammer (инструкции)
   */
  async installStm32Programmer() {
    let instructions = '';
    
    switch (this.currentPlatform) {
      case 'win32':
        instructions = 
          'Установка STM32CubeProgrammer на Windows:\n\n' +
          '1. Скачайте с https://www.st.com/en/development-tools/stm32cubeprog.html\n' +
          '2. Запустите установщик и следуйте инструкциям\n' +
          '3. По умолчанию устанавливается в:\n' +
          '   C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin\n' +
          '4. Добавьте этот путь в переменную окружения PATH\n' +
          '5. Перезапустите VS Code после установки\n';
        break;
      case 'darwin':
        instructions = 
          'Установка STM32CubeProgrammer на macOS:\n\n' +
          '1. Установите STM32CubeIDE (включает STM32CubeProgrammer):\n' +
          '   https://www.st.com/en/development-tools/stm32cubeide.html\n' +
          '2. После установки программер будет доступен по пути:\n' +
          '   /Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/.../tools/bin/STM32_Programmer_CLI\n' +
          '3. Или установите отдельно STM32CubeProgrammer с сайта ST\n';
        break;
      case 'linux':
        instructions = 
          'Установка STM32CubeProgrammer на Linux:\n\n' +
          '1. Скачайте с https://www.st.com/en/development-tools/stm32cubeprog.html\n' +
          '2. Распакуйте архив и запустите установку\n' +
          '3. Или используйте пакетный менеджер (если доступно)\n' +
          '4. Добавьте путь к программеру в PATH\n';
        break;
      default:
        instructions = 'Неизвестная платформа. Пожалуйста, установите STM32CubeProgrammer вручную.';
    }
    
    vscode.window.showInformationMessage(instructions, { modal: true });
    this.outputChannel.appendLine(`\n${instructions}`);
    this.outputChannel.show();
  }

  /**
   * Установка Python (инструкции)
   */
  async installPython() {
    let instructions = '';
    
    switch (this.currentPlatform) {
      case 'win32':
        instructions = 
          'Установка Python на Windows:\n\n' +
          '1. Скачайте с https://www.python.org/downloads/\n' +
          '2. Запустите установщик\n' +
          '3. Обязательно отметьте "Add Python to PATH"\n' +
          '4. После установки перезапустите VS Code\n' +
          '5. Проверьте установку: python --version\n';
        break;
      case 'darwin':
        instructions = 
          'Установка Python на macOS:\n\n' +
          'Способ 1 (через Homebrew):\n' +
          '   brew install python\n\n' +
          'Способ 2 (официальный установщик):\n' +
          '   Скачайте с https://www.python.org/downloads/macos/\n';
        break;
      case 'linux':
        instructions = 
          'Установка Python на Linux:\n\n' +
          'Для Debian/Ubuntu:\n' +
          '  sudo apt-get update\n' +
          '  sudo apt-get install python3 python3-pip\n\n' +
          'Для Arch Linux:\n' +
          '  sudo pacman -S python python-pip\n\n' +
          'Для Fedora:\n' +
          '  sudo dnf install python3 python3-pip\n';
        break;
      default:
        instructions = 'Неизвестная платформа. Пожалуйста, установите Python вручную.';
    }
    
    vscode.window.showInformationMessage(instructions, { modal: true });
    this.outputChannel.appendLine(`\n${instructions}`);
    this.outputChannel.show();
  }

  /**
   * Установка pyserial
   */
  async installPyserial() {
    const terminal = await runInTerminal(
      '', 
      'Установка pyserial', 
      this.workspacePath, 
      this.configManager.projectConfig, 
      this.outputChannel
    );
    
    terminal.sendText('echo "=== Установка pyserial ==="');
    terminal.sendText('echo ""');
    
    // Пробуем разные команды установки
    const commands = [
      'echo "Попытка установки через pip3..."',
      'pip3 install pyserial 2>&1 || echo "pip3 не сработал"',
      'echo ""',
      'echo "Попытка установки через pip..."',
      'pip install pyserial 2>&1 || echo "pip не сработал"',
      'echo ""',
      'echo "Попытка установки с правами пользователя..."',
      'pip install --user pyserial 2>&1 || echo "Установка с --user не сработала"',
      'echo ""',
      'echo "Проверка установки..."',
      'python3 -c "import serial; print(f\\"pyserial {serial.__version__} установлен\\")" 2>&1 || python -c "import serial; print(f\\"pyserial {serial.__version__} установлен\\")" 2>&1 || echo "pyserial не установлен"'
    ];
    
    commands.forEach(cmd => terminal.sendText(cmd));
    
    vscode.window.showInformationMessage('Установка pyserial запущена. Проверьте терминал.');
  }

  /**
   * Обновление путей к инструментам
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
}

module.exports = ToolsManager;