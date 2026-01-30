const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execCommand } = require('../utils');
const MakefileGenerator = require('../utils/makefileGenerator');

class BuildManager {
  constructor(workspacePath, configManager, outputChannel) {
    this.workspacePath = workspacePath;
    this.configManager = configManager;
    this.outputChannel = outputChannel;
    this.currentPlatform = configManager.currentPlatform;
    this.makefileGenerator = new MakefileGenerator(workspacePath, configManager);
  }

  /**
   * Проверяет наличие необходимых файлов перед сборкой
   */
  async checkProjectFiles() {
    const config = this.configManager.projectConfig;
    
    // Проверяем линкер
    if (!config.ldscript || !config.ldscriptPath) {
      this.outputChannel.appendLine('⚠️ Линкер не найден в конфигурации');
      const ldConfig = await this.configManager.findLinkerScript();
      if (!ldConfig) {
        return await this.handleMissingLinker();
      }
      config.ldscript = ldConfig.ldscript;
      config.ldscriptPath = ldConfig.ldscriptPath;
      this.configManager.saveConfig();
    }

    // Проверяем стартап файл
    if (!config.startupFile || !config.startupFilePath) {
      this.outputChannel.appendLine('⚠️ Стартап файл не найден в конфигурации');
      const startupConfig = await this.configManager.findStartupFile();
      if (!startupConfig) {
        return await this.handleMissingStartup();
      }
      config.startupFile = startupConfig.startupFile;
      config.startupFilePath = startupConfig.startupFilePath;
      this.configManager.saveConfig();
    }

    return true;
  }

  /**
   * Обработка отсутствия линкера
   */
  async handleMissingLinker() {
    const choice = await vscode.window.showWarningMessage(
      'Скрипт линкера не найден. Выберите действие:',
      'Найти автоматически',
      'Выбрать вручную',
      'Отмена сборки'
    );

    switch (choice) {
      case 'Найти автоматически':
        const ldConfig = await this.configManager.findLinkerScript();
        if (ldConfig) {
          this.configManager.projectConfig.ldscript = ldConfig.ldscript;
          this.configManager.projectConfig.ldscriptPath = ldConfig.ldscriptPath;
          this.configManager.saveConfig();
          return true;
        }
        break;

      case 'Выбрать вручную':
        return await this.selectLinkerScript();

      default:
        return false;
    }
    return false;
  }

  /**
   * Обработка отсутствия стартап файла
   */
  async handleMissingStartup() {
    const choice = await vscode.window.showWarningMessage(
      'Стартап файл не найден. Выберите действие:',
      'Найти автоматически',
      'Выбрать вручную',
      'Продолжить без стартапа'
    );

    switch (choice) {
      case 'Найти автоматически':
        const startupConfig = await this.configManager.findStartupFile();
        if (startupConfig) {
          this.configManager.projectConfig.startupFile = startupConfig.startupFile;
          this.configManager.projectConfig.startupFilePath = startupConfig.startupFilePath;
          this.configManager.saveConfig();
          return true;
        }
        break;

      case 'Выбрать вручную':
        return await this.selectStartupFile();

      case 'Продолжить без стартапа':
        this.outputChannel.appendLine('⚠️ Сборка продолжается без стартап файла');
        return true;

      default:
        return false;
    }
    return false;
  }

  /**
   * Сборка проекта STM32
   */
  async build() {
    console.log('Build command called');
    
    if (!this.workspacePath) {
      vscode.window.showErrorMessage('Не открыта папка рабочего пространства');
      return false;
    }

    // Проверяем конфигурацию проекта
    const configCheck = await this.checkProjectFiles();
    if (!configCheck) {
      return false;
    }

    // Обновляем Makefile если нужно
    if (this.configManager.projectConfig.autoUpdateMakefile) {
      this.makefileGenerator.updateMakefile();
    }

    // Выполняем сборку
    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Сборка проекта ${this.configManager.projectConfig.projectName}...`,
      cancellable: false
    }, async (progress) => {
      try {
        this.outputChannel.clear();
        this.outputChannel.show();
        
        // Показываем сводку о проекте
        await this.showProjectSummary();
        
        // Этап 1: Очистка предыдущей сборки
        progress.report({ message: 'Очистка предыдущей сборки...' });
        await this.cleanBuild();
        
        // Этап 2: Сборка проекта
        progress.report({ message: 'Сборка проекта...' });
        const buildSuccess = await this.executeBuild();
        
        if (!buildSuccess) {
          throw new Error('Сборка завершилась с ошибками');
        }
        
        // Сборка успешно завершена
        console.log('Процесс сборки завершен успешно');
        
        // Показываем результаты сборки
        await this.showBuildResults();
        
        return true;
        
      } catch (error) {
        console.error('Сборка завершилась с ошибкой:', error);
        await this.handleBuildError(error);
        return false;
      }
    });
  }

  /**
   * Показывает сводку о проекте
   */
  async showProjectSummary() {
    const config = this.configManager.projectConfig;
    const iocInfo = this.configManager.getIOCInfo();
    const mcuParams = this.configManager.getMCUParams(config.mcu);
    
    this.outputChannel.appendLine('='.repeat(60));
    this.outputChannel.appendLine('📋 ИНФОРМАЦИЯ О ПРОЕКТЕ');
    this.outputChannel.appendLine('='.repeat(60));
    
    if (iocInfo) {
      this.outputChannel.appendLine(`Микроконтроллер: ${iocInfo.mcu}`);
      this.outputChannel.appendLine(`Семейство: ${iocInfo.family}`);
      this.outputChannel.appendLine(`Проект: ${iocInfo.projectName}`);
      this.outputChannel.appendLine(`Компилятор: ${iocInfo.compiler}`);
    } else {
      this.outputChannel.appendLine(`Проект: ${config.projectName}`);
      this.outputChannel.appendLine(`Микроконтроллер: ${config.mcu}`);
    }
    
    this.outputChannel.appendLine(`Скрипт линкера: ${config.ldscript}`);
    this.outputChannel.appendLine(`Стартап файл: ${config.startupFile}.s`);
    
    this.outputChannel.appendLine(`\n🔧 Параметры компилятора:`);
    this.outputChannel.appendLine(`  CPU: ${mcuParams.cpu}`);
    if (mcuParams.fpu) {
      this.outputChannel.appendLine(`  FPU: ${mcuParams.fpu}`);
    }
    this.outputChannel.appendLine(`  Define: ${mcuParams.define}`);
    
    this.outputChannel.appendLine('='.repeat(60));
    this.outputChannel.appendLine('');
  }

  /**
   * Выбор скрипта линкера вручную
   */
  async selectLinkerScript() {
    if (!this.workspacePath) return false;
    
    try {
      const files = await vscode.workspace.findFiles('**/*.ld', '**/node_modules/**');
      if (files.length === 0) {
        vscode.window.showErrorMessage('Файлы линкера не найдены');
        return false;
      }

      const items = files.map(file => ({
        label: path.relative(this.workspacePath, file.fsPath),
        description: path.basename(file.fsPath),
        fsPath: file.fsPath
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Выберите скрипт линкера'
      });

      if (selected) {
        this.configManager.projectConfig.ldscript = path.basename(selected.fsPath);
        this.configManager.projectConfig.ldscriptPath = selected.fsPath;
        this.configManager.saveConfig();
        this.outputChannel.appendLine(`✅ Выбран скрипт линкера: ${selected.label}`);
        return true;
      }

      return false;
    } catch (error) {
      vscode.window.showErrorMessage(`Ошибка выбора скрипта линкера: ${error.message}`);
      return false;
    }
  }

  /**
   * Выбор стартап файла вручную
   */
  async selectStartupFile() {
    if (!this.workspacePath) return false;
    
    try {
      const files = await vscode.workspace.findFiles('**/*.s', '**/node_modules/**');
      if (files.length === 0) {
        vscode.window.showErrorMessage('Стартап файлы не найдены');
        return false;
      }

      const items = files.map(file => ({
        label: path.relative(this.workspacePath, file.fsPath),
        description: path.basename(file.fsPath),
        fsPath: file.fsPath
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Выберите стартап файл'
      });

      if (selected) {
        const startupName = path.basename(selected.fsPath, '.s').replace('.S', '');
        this.configManager.projectConfig.startupFile = startupName;
        this.configManager.projectConfig.startupFilePath = selected.fsPath;
        this.configManager.saveConfig();
        this.outputChannel.appendLine(`✅ Выбран стартап файл: ${selected.label}`);
        return true;
      }

      return false;
    } catch (error) {
      vscode.window.showErrorMessage(`Ошибка выбора стартап файла: ${error.message}`);
      return false;
    }
  }

  /**
   * Очистка предыдущей сборки
   */
  async cleanBuild() {
    try {
      await execCommand(
        'make clean', 
        'Очистка', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
    } catch (cleanError) {
      console.log('Очистка завершилась с предупреждением:', cleanError.message);
    }
  }

  /**
   * Выполнение сборки
   */
  async executeBuild() {
    try {
      await execCommand(
        'make -j4', 
        'Сборка', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      return true;
    } catch (buildError) {
      // Пробуем собрать без параллелизма
      this.outputChannel.appendLine('⚠ Попытка сборки без параллелизма...');
      try {
        await execCommand(
          'make', 
          'Сборка (без параллелизма)', 
          this.workspacePath, 
          this.configManager.projectConfig, 
          this.outputChannel
        );
        return true;
      } catch (singleBuildError) {
        throw singleBuildError;
      }
    }
  }

  /**
   * Показ результатов сборки
   */
  async showBuildResults() {
    const projectName = this.configManager.projectConfig.projectName;
    const choices = ['Открыть вывод'];
    
    if (this.checkBuildFiles()) {
      choices.push('Прошить устройство');
      choices.push('Анализ размера прошивки');
    }
    
    vscode.window.showInformationMessage(
      '✅ Сборка успешно завершена!',
      ...choices
    ).then(async (choice) => {
      if (choice === 'Открыть вывод') {
        this.outputChannel.show();
      } else if (choice === 'Прошить устройство') {
        vscode.commands.executeCommand('stm32.upload');
      } else if (choice === 'Анализ размера прошивки') {
        await this.analyzeFirmwareSize();
      }
    });
  }

  /**
   * Проверка наличия собранных файлов
   */
  checkBuildFiles() {
    if (!this.workspacePath) return false;
    
    const projectName = this.configManager.projectConfig.projectName;
    const possiblePaths = [
      path.join(this.workspacePath, 'build', `${projectName}.elf`),
      path.join(this.workspacePath, 'build', `${projectName}.hex`),
      path.join(this.workspacePath, 'build', `${projectName}.bin`),
      path.join(this.workspacePath, 'build/bin', `${projectName}.elf`),
      path.join(this.workspacePath, 'build/bin', `${projectName}.hex`),
      path.join(this.workspacePath, 'build/bin', `${projectName}.bin`)
    ];
    
    return possiblePaths.some(p => fs.existsSync(p));
  }

  /**
   * Анализ размера прошивки
   */
  async analyzeFirmwareSize() {
    if (!this.workspacePath) {
      vscode.window.showErrorMessage('Не открыта папка рабочего пространства');
      return;
    }

    const projectName = this.configManager.projectConfig.projectName;
    const elfPath = path.join(this.workspacePath, 'build', `${projectName}.elf`);
    const binElfPath = path.join(this.workspacePath, 'build/bin', `${projectName}.elf`);
    
    let targetElfPath = null;
    
    if (fs.existsSync(elfPath) ) {
      targetElfPath = elfPath;
    } else if (fs.existsSync(binElfPath)) {
      targetElfPath = binElfPath;
    } else {
      vscode.window.showErrorMessage('❌ ELF файл не найден. Сначала соберите проект.');
      return;
    }

    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      this.outputChannel.appendLine('=== Анализ размера прошивки ===\n');
      
      // Используем arm-none-eabi-size для анализа
      const { stdout } = await execPromise(`arm-none-eabi-size "${targetElfPath}"`);
      this.outputChannel.appendLine(stdout);
      
      // Показываем информацию о памяти
      const mcuName = this.configManager.projectConfig.mcu;
      const memorySizes = this.configManager.getMemorySizes(mcuName);
      
      this.outputChannel.appendLine('\n=== Память контроллера ===');
      this.outputChannel.appendLine(`FLASH (память программ): ${memorySizes.flash}`);
      this.outputChannel.appendLine(`SRAM (оперативная память): ${memorySizes.ram}`);
      if (memorySizes.ccmram !== '0K') {
        this.outputChannel.appendLine(`CCMRAM (скоростная RAM): ${memorySizes.ccmram}`);
      }
      
      this.outputChannel.show();
      
    } catch (error) {
      this.outputChannel.appendLine(`❌ Ошибка анализа размера: ${error.message}`);
      this.outputChannel.show();
    }
  }

  /**
   * Обработка ошибок сборки
   */
  async handleBuildError(error) {
    let errorMessage = 'Сборка завершилась с ошибкой. ';
    let suggestedActions = ['Открыть вывод'];
    
    if (error.message && error.message.includes('make: command not found')) {
      errorMessage += 'Утилита make не установлена.';
      suggestedActions.push('Проверить инструменты');
    } else if (error.message && error.message.includes('arm-none-eabi')) {
      errorMessage += 'Цепочка инструментов ARM GCC не установлена или не в PATH.';
      suggestedActions.push('Проверить инструменты');
    } else if (error.message && error.message.includes('.ld')) {
      errorMessage += `Проблема со скриптом линкера: ${this.configManager.projectConfig.ldscript}`;
      suggestedActions.push('Проверить скрипт линкера');
    } else if (error.message && error.message.includes('startup') || error.message.includes('.s')) {
      errorMessage += 'Проблема с startup файлом.';
      suggestedActions.push('Проверить startup файл');
    } else {
      errorMessage += error.message;
    }
    
    vscode.window.showErrorMessage(
      errorMessage,
      ...suggestedActions
    ).then(choice => {
      if (choice === 'Открыть вывод') {
        this.outputChannel.show();
      } else if (choice === 'Проверить инструменты') {
        vscode.commands.executeCommand('stm32.checkTools');
      } else if (choice === 'Проверить скрипт линкера') {
        this.configManager.projectConfig.ldscript = null;
        this.configManager.projectConfig.ldscriptPath = null;
        this.configManager.saveConfig();
        vscode.window.showInformationMessage('Конфигурация линкера сброшена. Попробуйте собрать снова.');
      } else if (choice === 'Проверить startup файл') {
        this.configManager.projectConfig.startupFile = null;
        this.configManager.projectConfig.startupFilePath = null;
        this.configManager.saveConfig();
        vscode.window.showInformationMessage('Конфигурация стартапа сброшена. Попробуйте собрать снова.');
      }
    });
  }

  /**
   * Быстрая сборка без очистки
   */
  async quickBuild() {
    if (!this.workspacePath) {
      vscode.window.showErrorMessage('Не открыта папка рабочего пространства');
      return false;
    }

    try {
      this.outputChannel.clear();
      this.outputChannel.show();
      
      // Показываем краткую информацию о проекте
      const iocInfo = this.configManager.getIOCInfo();
      if (iocInfo) {
        this.outputChannel.appendLine(`🚀 Быстрая сборка проекта: ${iocInfo.projectName}`);
        this.outputChannel.appendLine(`🎯 Микроконтроллер: ${iocInfo.mcu}`);
      }
      
      await execCommand(
        'make -j4', 
        'Быстрая сборка', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      vscode.window.showInformationMessage('✅ Быстрая сборка завершена!');
      return true;
    } catch (error) {
      console.error('Быстрая сборка завершилась с ошибкой:', error);
      vscode.window.showErrorMessage(`❌ Быстрая сборка завершилась с ошибкой: ${error.message}`);
      this.outputChannel.show();
      return false;
    }
  }

  /**
   * Очистка сборки
   */
  async clean() {
    try {
      await execCommand(
        'make clean', 
        'Очистка', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      vscode.window.showInformationMessage('🧹 Очистка завершена.');
      return true;
    } catch (error) {
      vscode.window.showErrorMessage('❌ Очистка завершилась с ошибкой.');
      return false;
    }
  }

  /**
   * Полная очистка (включая директорию build)
   */
  async fullClean() {
    try {
      if (this.currentPlatform === 'win32') {
        await execCommand(
          'make clean && if exist build rmdir /s /q build', 
          'Полная очистка', 
          this.workspacePath, 
          this.configManager.projectConfig, 
          this.outputChannel
        );
      } else {
        await execCommand(
          'make clean && rm -rf build', 
          'Полная очистка', 
          this.workspacePath, 
          this.configManager.projectConfig, 
          this.outputChannel
        );
      }
      vscode.window.showInformationMessage('🧹 Полная очистка завершена.');
      return true;
    } catch (error) {
      vscode.window.showErrorMessage('❌ Полная очистка завершилась с ошибкой.');
      return false;
    }
  }

  /**
   * Проверка инструментов сборки
   */
  async checkBuildTools() {
    const config = this.configManager.projectConfig;
    const tools = [
      { name: 'make', command: 'make --version', required: true },
      { name: 'arm-none-eabi-gcc', command: 'arm-none-eabi-gcc --version', required: true },
      { name: 'STM32_Programmer_CLI', command: 'STM32_Programmer_CLI --version', required: false }
    ];
    
    this.outputChannel.clear();
    this.outputChannel.show();
    this.outputChannel.appendLine('=== Проверка инструментов сборки ===\n');
    
    for (const tool of tools) {
      try {
        await execCommand(
          tool.command,
          `Проверка ${tool.name}`,
          this.workspacePath,
          config,
          this.outputChannel,
          { silent: true }
        );
        this.outputChannel.appendLine(`✅ ${tool.name}: Установлен`);
      } catch (error) {
        if (tool.required) {
          this.outputChannel.appendLine(`❌ ${tool.name}: НЕ УСТАНОВЛЕН (обязательный инструмент)`);
        } else {
          this.outputChannel.appendLine(`⚠️  ${tool.name}: НЕ УСТАНОВЛЕН (опциональный инструмент)`);
        }
      }
    }
    
    // Проверка конфигурации проекта
    this.outputChannel.appendLine('\n=== Проверка конфигурации проекта ===');
    const iocInfo = this.configManager.getIOCInfo();
    if (iocInfo) {
      this.outputChannel.appendLine(`✅ Проект: ${iocInfo.projectName}`);
      this.outputChannel.appendLine(`✅ Микроконтроллер: ${iocInfo.mcu}`);
      this.outputChannel.appendLine(`✅ Компилятор: ${iocInfo.compiler}`);
    } else {
      this.outputChannel.appendLine('⚠️  Информация из .ioc файла не загружена');
    }
    
    // Проверка скрипта линкера
    const ldscriptPath = path.join(this.workspacePath, config.ldscript);
    if (fs.existsSync(ldscriptPath)) {
      this.outputChannel.appendLine(`✅ Скрипт линкера: ${config.ldscript} (найден)`);
    } else {
      this.outputChannel.appendLine(`❌ Скрипт линкера: ${config.ldscript} (НЕ НАЙДЕН)`);
    }
    
    // Проверка Makefile
    const makefileCheck = this.makefileGenerator.checkMakefile();
    if (makefileCheck.upToDate) {
      this.outputChannel.appendLine(`✅ Makefile: ${makefileCheck.message}`);
    } else {
      this.outputChannel.appendLine(`❌ Makefile: ${makefileCheck.message}`);
      if (makefileCheck.details) {
        this.outputChannel.appendLine(`   Текущий стартап: ${makefileCheck.details.currentStartup}`);
        this.outputChannel.appendLine(`   Ожидаемый стартап: ${makefileCheck.details.expectedStartup}`);
        this.outputChannel.appendLine(`   Текущий линкер: ${makefileCheck.details.currentLdscript}`);
        this.outputChannel.appendLine(`   Ожидаемый линкер: ${makefileCheck.details.expectedLdscript}`);
      }
    }
    
    this.outputChannel.appendLine('\n=== Рекомендации ===');
    this.outputChannel.appendLine('1. Для установки ARM GCC используйте:');
    this.outputChannel.appendLine('   - Linux: sudo apt-get install gcc-arm-none-eabi');
    this.outputChannel.appendLine('   - macOS: brew install arm-none-eabi-gcc');
    this.outputChannel.appendLine('   - Windows: скачайте с https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain/gnu-rm');
    this.outputChannel.appendLine('2. STM32_Programmer_CLI можно скачать с https://www.st.com/en/development-tools/stm32cubeprog.html');
    
    vscode.window.showInformationMessage(
      'Проверка инструментов завершена. Результаты в выводе.',
      'Открыть вывод'
    ).then(choice => {
      if (choice === 'Открыть вывод') {
        this.outputChannel.show();
      }
    });
  }
}

module.exports = BuildManager;