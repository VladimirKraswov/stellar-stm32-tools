const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const MakefileGenerator = require('../utils/makefileGenerator');

class ProjectManager {
  constructor(workspacePath, configManager, outputChannel) {
    this.workspacePath = workspacePath;
    this.configManager = configManager;
    this.outputChannel = outputChannel;
    this.makefileGenerator = new MakefileGenerator(workspacePath, configManager);
  }

  /**
   * Настройка проекта STM32
   */
  async setupProject() {
    console.log('Setup Project called');
    
    if (!this.workspacePath) {
      vscode.window.showErrorMessage('Откройте папку рабочего пространства сначала');
      return false;
    }

    // Загружаем конфигурацию из .ioc файла
    await this.configManager.loadIOCConfig();

    // Инициализируем конфигурацию (ищем линкер и стартап)
    await this.configManager.initializeProjectConfig();

    // Проверяем наличие файлов
    const filesExist = await this.verifyProjectFiles();
    if (!filesExist) {
      return false;
    }

    // Сохраняем конфигурацию
    this.configManager.saveConfig();

    // Создаем/обновляем Makefile
    await this.makefileGenerator.generateMakefile();

    // Создаем конфигурацию VS Code
    await this.createVSCodeConfig();

    vscode.window.showInformationMessage(
      `Проект "${this.configManager.projectConfig.projectName}" успешно настроен!`,
      'Тестовая сборка',
      'Показать конфигурацию',
      'Открыть папку'
    ).then(choice => {
      if (choice === 'Тестовая сборка') {
        vscode.commands.executeCommand('stm32.build');
      } else if (choice === 'Показать конфигурацию') {
        this.showProjectConfiguration();
      } else if (choice === 'Открыть папку') {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.workspacePath));
      }
    });

    return true;
  }

  /**
   * Проверяет наличие необходимых файлов проекта
   */
  async verifyProjectFiles() {
    const config = this.configManager.projectConfig;
    
    // Проверяем линкер
    if (!config.ldscript || !config.ldscriptPath) {
      const ldConfig = await this.configManager.findLinkerScript();
      if (!ldConfig) {
        const choice = await vscode.window.showWarningMessage(
          'Скрипт линкера не найден. Продолжить настройку?',
          'Продолжить',
          'Отмена'
        );
        if (choice !== 'Продолжить') return false;
      } else {
        config.ldscript = ldConfig.ldscript;
        config.ldscriptPath = ldConfig.ldscriptPath;
      }
    }

    // Проверяем стартап файл
    if (!config.startupFile || !config.startupFilePath) {
      const startupConfig = await this.configManager.findStartupFile();
      if (!startupConfig) {
        const choice = await vscode.window.showWarningMessage(
          'Стартап файл не найден. Продолжить настройку?',
          'Продолжить',
          'Отмена'
        );
        if (choice !== 'Продолжить') return false;
      } else {
        config.startupFile = startupConfig.startupFile;
        config.startupFilePath = startupConfig.startupFilePath;
      }
    }

    return true;
  }

  /**
   * Показывает конфигурацию проекта
   */
  showProjectConfiguration() {
    const config = this.configManager.projectConfig;
    const iocInfo = this.configManager.getIOCInfo();
    
    let infoText = '=== КОНФИГУРАЦИЯ ПРОЕКТА ===\n\n';
    infoText += `📁 Рабочая папка: ${this.workspacePath}\n\n`;
    
    if (iocInfo) {
      infoText += '📋 Информация из .ioc файла:\n';
      infoText += `  3. Микроконтроллер: ${iocInfo.mcu}\n`;
      infoText += `  Семейство: ${iocInfo.family}\n`;
      infoText += `  Проект: ${iocInfo.projectName}\n`;
      infoText += `  Компилятор: ${iocInfo.compiler}\n\n`;
    }
    
    infoText += '⚙️  Настройки сборки:\n';
    infoText += `  Имя проекта: ${config.projectName}\n`;
    infoText += `  MCU: ${config.mcu}\n`;
    infoText += `  Скрипт линкера: ${config.ldscript || 'не найден'}\n`;
    infoText += `  Путь к линкеру: ${config.ldscriptPath || 'не найден'}\n`;
    infoText += `  Стартап файл: ${config.startupFile || 'не найден'}\n`;
    infoText += `  Путь к стартапу: ${config.startupFilePath || 'не найден'}\n`;
    infoText += `  Автообновление Makefile: ${config.autoUpdateMakefile ? 'да' : 'нет'}\n`;
    
    vscode.window.showInformationMessage(infoText, { modal: true });
    this.outputChannel.appendLine(infoText);
    this.outputChannel.show();
  }

  /**
   * Создает конфигурацию VS Code
   */
  async createVSCodeConfig() {
    const vscodeDir = path.join(this.workspacePath, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }

    // Создаем tasks.json
    await this.createTasksConfig(vscodeDir);
    
    // Создаем settings.json
    await this.createSettingsConfig(vscodeDir);
  }

  /**
   * Создает конфигурацию задач
   */
  async createTasksConfig(vscodeDir) {
    const tasksPath = path.join(vscodeDir, 'tasks.json');
    if (!fs.existsSync(tasksPath)) {
      const tasksJson = {
        "version": "2.0.0",
        "tasks": [
          {
            "label": "Build STM32",
            "type": "shell",
            "command": "make -j4",
            "group": {
              "kind": "build",
              "isDefault": true
            },
            "problemMatcher": ["$gcc"],
            "options": {
              "cwd": "${workspaceFolder}"
            }
          },
          {
            "label": "Clean STM32",
            "type": "shell",
            "command": "make clean",
            "problemMatcher": [],
            "options": {
              "cwd": "${workspaceFolder}"
            }
          }
        ]
      };
      fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 2));
      console.log('Создан tasks.json');
    }
  }

  /**
   * Создает конфигурацию настроек
   */
  async createSettingsConfig(vscodeDir) {
    const settingsPath = path.join(vscodeDir, 'settings.json');
    
    // Читаем существующие настройки, если есть
    let existingSettings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch (e) {
        console.log('Не удалось прочитать существующие настройки:', e);
      }
    }
    
    // Обновляем настройки для STM32
    const stm32Settings = {
      "files.associations": {
        "*.h": "c",
        "stm32f4xx_hal.h": "c",
        "stm32f4xx*.h": "c",
        "*.c": "c",
        "*.ld": "ld"
      },
      "C_Cpp.intelliSenseEngine": "default",
      "C_Cpp.default.configurationProvider": "ms-vscode.cpptools"
    };
    
    // Объединяем настройки
    const mergedSettings = { ...existingSettings, ...stm32Settings };
    
    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    console.log('Создан/обновлен settings.json');
  }

  /**
   * Генерирует Makefile для проекта
   */
  async generateMakefile() {
    try {
      const success = this.makefileGenerator.generateMakefile();
      if (success) {
        this.outputChannel.appendLine('✅ Makefile успешно сгенерирован');
      } else {
        this.outputChannel.appendLine('❌ Ошибка генерации Makefile');
      }
      return success;
    } catch (error) {
      this.outputChannel.appendLine(`❌ Ошибка генерации Makefile: ${error.message}`);
      return false;
    }
  }

  /**
   * Проверяет актуальность Makefile
   */
  async checkMakefile() {
    return this.makefileGenerator.checkMakefile();
  }
}

module.exports = ProjectManager;