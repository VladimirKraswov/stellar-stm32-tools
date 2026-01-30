// managers/FlashManager.js
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execCommand, runInTerminal } = require('../utils');

class FlashManager {
  constructor(workspacePath, configManager, outputChannel, buildManager, connectionManager) {
    this.workspacePath = workspacePath;
    this.configManager = configManager;
    this.outputChannel = outputChannel;
    this.buildManager = buildManager;
    this.connectionManager = connectionManager;
    this.currentPlatform = configManager.currentPlatform;
    this.flashHistory = [];
  }

  /**
   * Прошивка устройства
   */
  async upload(forceBuild = false) {
    console.log('Upload command called');
    
    // Всегда выполняем сборку перед прошивкой
    const buildSuccess = await this.buildManager.build();
    if (!buildSuccess) {
      vscode.window.showErrorMessage('Сборка не удалась. Прошивка отменена.');
      return false;
    }
    
    // После сборки находим файл прошивки
    const firmwarePath = await this.findFirmwareFile();
    
    if (!firmwarePath) {
      vscode.window.showErrorMessage('Прошивка не найдена после сборки');
      return false;
    }
    
    return await this.flashFirmware(firmwarePath);
  }

  /**
   * Поиск файла прошивки
   */
  async findFirmwareFile() {
    if (!this.workspacePath) return null;
    
    const projectName = this.configManager.projectConfig.projectName;
    const possiblePaths = [
      // В директории build/bin
      path.join(this.workspacePath, 'build/bin', `${projectName}.hex`),
      path.join(this.workspacePath, 'build/bin', `${projectName}.bin`),
      // В директории build
      path.join(this.workspacePath, 'build', `${projectName}.hex`),
      path.join(this.workspacePath, 'build', `${projectName}.bin`),
      // Любые hex/bin файлы в build
      path.join(this.workspacePath, 'build', '*.hex'),
      path.join(this.workspacePath, 'build', '*.bin'),
      // В корне проекта (для старых проектов)
      path.join(this.workspacePath, `${projectName}.hex`),
      path.join(this.workspacePath, `${projectName}.bin`)
    ];
    
    // Проверяем конкретные пути
    for (const filePath of possiblePaths) {
      if (filePath.includes('*')) {
        // Для шаблонов ищем файлы
        const dir = path.dirname(filePath);
        const pattern = path.basename(filePath);
        
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          const matchingFiles = files.filter(f => {
            if (pattern === '*.hex') return f.endsWith('.hex');
            if (pattern === '*.bin') return f.endsWith('.bin');
            return false;
          });
          
          if (matchingFiles.length > 0) {
            return path.join(dir, matchingFiles[0]);
          }
        }
      } else if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    
    return null;
  }

  /**
   * Прошивка файла в устройство
   */
  async flashFirmware(firmwarePath) {
    if (!firmwarePath || !fs.existsSync(firmwarePath)) {
      vscode.window.showErrorMessage(`Файл прошивки не найден: ${firmwarePath}`);
      return false;
    }

    const fileSize = fs.statSync(firmwarePath).size;
    const fileExt = path.extname(firmwarePath).toLowerCase();
    const fileName = path.basename(firmwarePath);
    
    console.log(`Прошивка файла: ${fileName} (${this.formatFileSize(fileSize)})`);
    
    // Проверяем доступность программатора
    const programmerPath = this.configManager.projectConfig.programmerPath;
    if (!fs.existsSync(programmerPath)) {
      vscode.window.showErrorMessage(
        `Программер не найден: ${programmerPath}`,
        'Обновить путь'
      ).then(choice => {
        if (choice === 'Обновить путь') {
          this.configManager.updateToolPaths();
        }
      });
      return false;
    }

    // Показываем информацию о прошивке
    const flashInfo = await vscode.window.showInformationMessage(
      `Прошивка: ${fileName}\nРазмер: ${this.formatFileSize(fileSize)}\n\nПродолжить?`,
      { modal: true },
      'Прошить',
      'Отмена'
    );
    
    if (flashInfo !== 'Прошить') {
      return false;
    }

    // Выполняем прошивку с прогрессом
    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Прошивка STM32...',
      cancellable: false
    }, async (progress) => {
      try {
        progress.report({ message: 'Подготовка...' });
        
        this.outputChannel.clear();
        this.outputChannel.show();
        this.outputChannel.appendLine(`=== Прошивка STM32 ===`);
        this.outputChannel.appendLine(`Файл: ${fileName}`);
        this.outputChannel.appendLine(`Путь: ${firmwarePath}`);
        this.outputChannel.appendLine(`Размер: ${this.formatFileSize(fileSize)}`);
        this.outputChannel.appendLine(`Программер: ${programmerPath}`);
        this.outputChannel.appendLine('');
        
        // Формируем команду для прошивки
        let command;
        if (fileExt === '.hex') {
          command = `"${programmerPath}" -c port=SWD -w "${firmwarePath}" -v -rst`;
        } else if (fileExt === '.bin') {
          // Для bin файлов нужно указать начальный адрес (обычно 0x08000000 для STM32)
          command = `"${programmerPath}" -c port=SWD -w "${firmwarePath}" 0x08000000 -v -rst`;
        } else {
          throw new Error(`Неподдерживаемый формат файла: ${fileExt}`);
        }
        
        progress.report({ message: 'Подготовка...' });
        
        // Сначала проверяем подключение ST-LINK
        try {
          await execCommand(
            `"${programmerPath}" -l`,
            'Проверка ST-LINK',
            this.workspacePath,
            this.configManager.projectConfig,
            this.outputChannel
          );
        } catch (error) {
          this.outputChannel.appendLine('⚠ ST-LINK проверка завершилась с ошибкой, продолжаем...');
        }
        
        progress.report({ message: 'Прошивка...' });
        
        // Выполняем прошивку
        const startTime = Date.now();
        await execCommand(
          command,
          'Прошивка',
          this.workspacePath,
          this.configManager.projectConfig,
          this.outputChannel
        );
        const endTime = Date.now();
        const flashTime = (endTime - startTime) / 1000;
        
        // Записываем в историю
        this.addToHistory({
          file: fileName,
          path: firmwarePath,
          size: fileSize,
          time: new Date().toISOString(),
          duration: flashTime,
          success: true
        });
        
        // Показываем успешное сообщение
        const successMessage = `✅ Прошивка успешно завершена за ${flashTime.toFixed(1)} секунд!`;
        this.outputChannel.appendLine(`\n${successMessage}`);
        
        vscode.window.showInformationMessage(
          successMessage,
          'Открыть вывод',
          'Запустить монитор',
          'Перезагрузить МК'
        ).then(async (choice) => {
          if (choice === 'Открыть вывод') {
            this.outputChannel.show();
          } else if (choice === 'Запустить монитор') {
            // Запуск монитора
            vscode.commands.executeCommand('stm32.monitor');
          } else if (choice === 'Перезагрузить МК') {
            await this.resetMicrocontroller();
          }
        });
        
        return true;
      } catch (error) {
        console.error('Ошибка прошивки:', error);
        
        // Записываем в историю
        this.addToHistory({
          file: fileName,
          path: firmwarePath,
          size: fileSize,
          time: new Date().toISOString(),
          duration: 0,
          success: false,
          error: error.message
        });
        
        await this.handleFlashError(error, firmwarePath);
        return false;
      }
    });
  }

  /**
   * Прошивка с последующим запуском монитора
   */
  async uploadAndMonitor() {
    // Всегда выполняем сборку перед прошивкой
    const buildSuccess = await this.buildManager.build();
    if (!buildSuccess) {
      vscode.window.showErrorMessage('Сборка не удалась. Прошивка отменена.');
      return false;
    }
    
    // После сборки находим файл прошивки
    const firmwarePath = await this.findFirmwareFile();
    
    if (!firmwarePath) {
      vscode.window.showErrorMessage('Прошивка не найдена после сборки');
      return false;
    }
    
    // Выполняем прошивку
    const flashSuccess = await this.flashFirmware(firmwarePath);
    
    if (!flashSuccess) {
      return false;
    }
    
    // Ждем перезагрузки МК
    vscode.window.showInformationMessage('Ожидание перезагрузки МК...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Запускаем монитор
    vscode.commands.executeCommand('stm32.smartMonitor');
    
    return true;
  }

  /**
   * Прошивка только что собранной прошивки
   */
  async flashLatestBuild() {
    // Всегда выполняем сборку
    const buildSuccess = await this.buildManager.build();
    if (!buildSuccess) {
      vscode.window.showErrorMessage('Сборка не удалась. Прошивка отменена.');
      return false;
    }
    
    // После сборки находим файл прошивки
    const firmwarePath = await this.findFirmwareFile();
    
    if (!firmwarePath) {
      vscode.window.showErrorMessage('Прошивка не найдена после сборки');
      return false;
    }
    
    return await this.flashFirmware(firmwarePath);
  }

  /**
   * Обработка ошибок прошивки
   */
  async handleFlashError(error, firmwarePath) {
    let errorMessage = 'Ошибка прошивки: ';
    let suggestedActions = ['Открыть вывод'];
    
    if (error.message.includes('ST-LINK')) {
      errorMessage += 'Проблема с ST-LINK подключением. ';
      suggestedActions.push('Проверить ST-LINK');
      suggestedActions.push('Проверить подключение');
    } else if (error.message.includes('No ST-LINK')) {
      errorMessage += 'ST-LINK не найден. ';
      suggestedActions.push('Проверить ST-LINK');
    } else if (error.message.includes('target')) {
      errorMessage += 'Не удалось подключиться к целевому устройству. ';
      suggestedActions.push('Проверить подключение');
      suggestedActions.push('Проверить питание МК');
    } else if (error.message.includes('File')) {
      errorMessage += 'Проблема с файлом прошивки. ';
      suggestedActions.push('Проверить файл');
      suggestedActions.push('Пересобрать проект');
    } else if (error.message.includes('memory')) {
      errorMessage += 'Ошибка доступа к памяти. ';
      suggestedActions.push('Проверить МК');
      suggestedActions.push('Сбросить МК');
    } else {
      errorMessage += error.message;
    }
    
    // Показываем расширенные предложения
    const choice = await vscode.window.showErrorMessage(
      errorMessage,
      ...suggestedActions
    );
    
    if (choice === 'Открыть вывод') {
      this.outputChannel.show();
    } else if (choice === 'Проверить ST-LINK') {
      this.connectionManager.checkStLinkConnection();
    } else if (choice === 'Проверить подключение') {
      this.connectionManager.checkMcuConnection();
    } else if (choice === 'Проверить файл') {
      this.verifyFirmwareFile(firmwarePath);
    } else if (choice === 'Пересобрать проект') {
      this.buildManager.build();
    } else if (choice === 'Проверить питание МК') {
      vscode.window.showInformationMessage(
        'Проверьте:\n1. Подключено ли питание к МК\n2. Правильно ли подключен GND\n3. Не перегружена ли схема',
        { modal: true }
      );
    } else if (choice === 'Проверить МК') {
      this.connectionManager.readMcuInfo();
    } else if (choice === 'Сбросить МК') {
      this.connectionManager.resetMcu();
    }
  }

  /**
   * Проверка файла прошивки
   */
  async verifyFirmwareFile(firmwarePath) {
    if (!firmwarePath || !fs.existsSync(firmwarePath)) {
      vscode.window.showErrorMessage('Файл не найден');
      return false;
    }
    
    const stats = fs.statSync(firmwarePath);
    const fileSize = stats.size;
    const fileName = path.basename(firmwarePath);
    
    let info = `=== Проверка файла прошивки ===\n\n`;
    info += `Имя: ${fileName}\n`;
    info += `Путь: ${firmwarePath}\n`;
    info += `Размер: ${this.formatFileSize(fileSize)}\n`;
    info += `Изменен: ${stats.mtime.toLocaleString()}\n`;
    
    // Проверяем расширение
    const ext = path.extname(firmwarePath).toLowerCase();
    if (ext === '.hex') {
      info += `Формат: Intel HEX\n`;
      
      // Читаем первую строку HEX файла
      try {
        const content = fs.readFileSync(firmwarePath, 'utf8');
        const firstLine = content.split('\n')[0];
        info += `Первая строка: ${firstLine.trim()}\n`;
        
        // Проверяем минимальную валидность HEX
        if (firstLine.startsWith(':')) {
          info += `✅ HEX файл выглядит валидным\n`;
        } else {
          info += `⚠ HEX файл может быть поврежден\n`;
        }
      } catch (e) {
        info += `❌ Не удалось прочитать файл: ${e.message}\n`;
      }
    } else if (ext === '.bin') {
      info += `Формат: Binary (BIN)\n`;
      info += `Для STM32 обычно загружается по адресу 0x08000000\n`;
    } else {
      info += `⚠ Неподдерживаемый формат: ${ext}\n`;
    }
    
    // Проверяем размер (предупреждение если слишком большой/маленький)
    if (fileSize < 100) {
      info += `⚠ Файл очень маленький, возможно поврежден\n`;
    } else if (fileSize > 1024 * 1024) { // 1 MB
      info += `⚠ Файл очень большой для STM32F407\n`;
    }
    
    vscode.window.showInformationMessage(info, { modal: true });
    this.outputChannel.appendLine(info);
    this.outputChannel.show();
    
    return true;
  }

  /**
   * Сброс микроконтроллера
   */
  async resetMicrocontroller() {
    try {
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      this.outputChannel.appendLine('=== Сброс микроконтроллера ===');
      
      await execCommand(
        `"${programmerPath}" -c port=SWD -rst`,
        'Сброс МК',
        this.workspacePath,
        this.configManager.projectConfig,
        this.outputChannel
      );
      
      vscode.window.showInformationMessage('Микроконтроллер сброшен');
      return true;
    } catch (error) {
      console.error('Ошибка сброса МК:', error);
      vscode.window.showErrorMessage(`Ошибка сброса МК: ${error.message}`);
      return false;
    }
  }

  /**
   * Стереть Flash память
   */
  async eraseFlash() {
    const choice = vscode.window.showWarningMessage(
      'Вы уверены, что хотите стереть всю Flash память? Это действие необратимо.',
      { modal: true },
      'Стереть',
      'Отмена'
    );
    
    if (choice !== 'Стереть') {
      return false;
    }
    
    try {
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      this.outputChannel.appendLine('=== Стирание Flash памяти ===');
      
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Стирание Flash...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Стирание...' });
        
        await execCommand(
          `"${programmerPath}" -c port=SWD -e all`,
          'Стирание Flash',
          this.workspacePath,
          this.configManager.projectConfig,
          this.outputChannel
        );
      });
      
      vscode.window.showInformationMessage('Flash память успешно стерта');
      return true;
    } catch (error) {
      console.error('Ошибка стирания Flash:', error);
      vscode.window.showErrorMessage(`Ошибка стирания Flash: ${error.message}`);
      return false;
    }
  }

  /**
   * Проверка прошивки в устройстве
   */
  async verifyFlash() {
    const firmwarePath = await this.findFirmwareFile();
    
    if (!firmwarePath) {
      vscode.window.showErrorMessage('Файл прошивки не найден для проверки');
      return false;
    }
    
    try {
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      this.outputChannel.appendLine('=== Проверка прошивки в устройстве ===');
      
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Проверка прошивки...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Чтение Flash памяти...' });
        
        // Для HEX файлов используем команду verify
        if (firmwarePath.endsWith('.hex')) {
          await execCommand(
            `"${programmerPath}" -c port=SWD -vr "${firmwarePath}"`,
            'Проверка прошивки',
            this.workspacePath,
            this.configManager.projectConfig,
            this.outputChannel
          );
        } else {
          // Для BIN файлов нужно указать адрес
          await execCommand(
            `"${programmerPath}" -c port=SWD -vr "${firmwarePath}" 0x08000000`,
            'Проверка прошивки',
            this.workspacePath,
            this.configManager.projectConfig,
            this.outputChannel
          );
        }
      });
      
      vscode.window.showInformationMessage('Проверка прошивки успешно завершена');
      return true;
    } catch (error) {
      console.error('Ошибка проверки прошивки:', error);
      vscode.window.showErrorMessage(`Ошибка проверки прошивки: ${error.message}`);
      return false;
    }
  }

  /**
   * Прошивка без сброса (для отладки)
   */
  async uploadWithoutReset() {
    // Всегда выполняем сборку
    const buildSuccess = await this.buildManager.build();
    if (!buildSuccess) {
      vscode.window.showErrorMessage('Сборка не удалась. Прошивка отменена.');
      return false;
    }
    
    // После сборки находим файл прошивки
    const firmwarePath = await this.findFirmwareFile();
    
    if (!firmwarePath) {
      vscode.window.showErrorMessage('Прошивка не найдена после сборки');
      return false;
    }
    
    try {
      const programmerPath = this.configManager.projectConfig.programmerPath;
      const fileExt = path.extname(firmwarePath).toLowerCase();
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      this.outputChannel.appendLine('=== Прошивка без сброса ===');
      
      // Формируем команду без флага -rst
      let command;
      if (fileExt === '.hex') {
        command = `"${programmerPath}" -c port=SWD -w "${firmwarePath}" -v`;
      } else {
        command = `"${programmerPath}" -c port=SWD -w "${firmwarePath}" 0x08000000 -v`;
      }
      
      await execCommand(
        command,
        'Прошивка без сброса',
        this.workspacePath,
        this.configManager.projectConfig,
        this.outputChannel
      );
      
      vscode.window.showInformationMessage(
        'Прошивка завершена без сброса',
        'Сбросить МК',
        'Запустить монитор'
      ).then(async (choice) => {
        if (choice === 'Сбросить МК') {
          await this.resetMicrocontroller();
        } else if (choice === 'Запустить монитор') {
          vscode.commands.executeCommand('stm32.monitor');
        }
      });
      
      return true;
    } catch (error) {
      console.error('Ошибка прошивки без сброса:', error);
      vscode.window.showErrorMessage(`Ошибка прошивки без сброса: ${error.message}`);
      return false;
    }
  }

  /**
   * Чтение защиты (Option Bytes)
   */
  async readProtection() {
    try {
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      this.outputChannel.appendLine('=== Чтение защиты (Option Bytes) ===');
      
      const terminal = await runInTerminal(
        '',
        'Защита МК',
        this.workspacePath,
        this.configManager.projectConfig,
        this.outputChannel
      );
      
      const commands = [
        'echo "Чтение Option Bytes STM32..."',
        'echo ""',
        `"${programmerPath}" -c port=SWD -ob displ`,
        'echo ""',
        'echo "Интерпретация:"',
        'echo "  - RDP (Read Protection): уровень защиты чтения"',
        'echo "    0xAA: защита снята"',
        'echo "    0xCC: защита уровня 1"',
        'echo "  - WRP: защита от записи"',
        'echo "  - BOR: настройки Brown-Out Reset"',
        'echo ""',
        'echo "Внимание: снятие защиты стирает всю Flash память!"'
      ];
      
      commands.forEach(cmd => terminal.sendText(cmd));
      
      return true;
    } catch (error) {
      console.error('Ошибка чтения защиты:', error);
      vscode.window.showErrorMessage(`Ошибка чтения защиты: ${error.message}`);
      return false;
    }
  }

  /**
   * Показать историю прошивок
   */
  async showFlashHistory() {
    if (this.flashHistory.length === 0) {
      vscode.window.showInformationMessage('История прошивок пуста');
      return;
    }
    
    let historyText = '=== История прошивок ===\n\n';
    
    // Сортируем по времени (новые сверху)
    const sortedHistory = [...this.flashHistory].reverse();
    
    sortedHistory.forEach((entry, index) => {
      const time = new Date(entry.time).toLocaleString();
      const status = entry.success ? '✅' : '❌';
      const duration = entry.duration ? `${entry.duration.toFixed(1)}с` : 'N/A';
      
      historyText += `${index + 1}. ${time} ${status}\n`;
      historyText += `   Файл: ${entry.file}\n`;
      historyText += `   Размер: ${this.formatFileSize(entry.size)}\n`;
      historyText += `   Длительность: ${duration}\n`;
      
      if (entry.error) {
        historyText += `   Ошибка: ${entry.error}\n`;
      }
      
      historyText += '\n';
    });
    
    vscode.window.showInformationMessage(historyText, { modal: true });
    this.outputChannel.appendLine(historyText);
    this.outputChannel.show();
  }

  /**
   * Очистка истории прошивок
   */
  clearFlashHistory() {
    const choice = vscode.window.showWarningMessage(
      'Очистить историю прошивок?',
      { modal: true },
      'Очистить',
      'Отмена'
    );
    
    if (choice === 'Очистить') {
      this.flashHistory = [];
      vscode.window.showInformationMessage('История прошивок очищена');
    }
  }

  /**
   * Добавление записи в историю
   */
  addToHistory(entry) {
    this.flashHistory.push(entry);
    
    // Ограничиваем историю 50 записями
    if (this.flashHistory.length > 50) {
      this.flashHistory = this.flashHistory.slice(-50);
    }
    
    // Сохраняем историю в файл
    this.saveHistoryToFile();
  }

  /**
   * Сохранение истории в файл
   */
  async saveHistoryToFile() {
    if (!this.workspacePath) return;
    
    const historyPath = path.join(this.workspacePath, '.stm32-flash-history.json');
    
    try {
      fs.writeFileSync(
        historyPath,
        JSON.stringify(this.flashHistory, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('Ошибка сохранения истории:', error);
    }
  }

  /**
   * Загрузка истории из файла
   */
  async loadHistoryFromFile() {
    if (!this.workspacePath) return;
    
    const historyPath = path.join(this.workspacePath, '.stm32-flash-history.json');
    
    if (fs.existsSync(historyPath)) {
      try {
        const historyData = fs.readFileSync(historyPath, 'utf8');
        this.flashHistory = JSON.parse(historyData);
      } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        this.flashHistory = [];
      }
    }
  }

  /**
   * Форматирование размера файла
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Б';
    
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Показ информации о прошивке
   */
  async showFirmwareInfo() {
    const firmwarePath = await this.findFirmwareFile();
    
    if (!firmwarePath) {
      vscode.window.showErrorMessage('Файл прошивки не найден');
      return;
    }
    
    const stats = fs.statSync(firmwarePath);
    const fileSize = stats.size;
    const fileName = path.basename(firmwarePath);
    const fileExt = path.extname(firmwarePath);
    
    let info = `=== Информация о прошивке ===\n\n`;
    info += `Имя: ${fileName}\n`;
    info += `Размер: ${this.formatFileSize(fileSize)}\n`;
    info += `Формат: ${fileExt.toUpperCase()}\n`;
    info += `Путь: ${firmwarePath}\n`;
    info += `Изменен: ${stats.mtime.toLocaleString()}\n`;
    
    // Для ELF файлов можно получить больше информации
    if (firmwarePath.endsWith('.elf')) {
      try {
        const terminal = await runInTerminal(
          '',
          'Информация ELF',
          this.workspacePath,
          this.configManager.projectConfig,
          this.outputChannel
        );
        
        terminal.sendText(`arm-none-eabi-size "${firmwarePath}"`);
        terminal.sendText(`echo ""`);
        terminal.sendText(`arm-none-eabi-objdump -h "${firmwarePath}" | head -20`);
      } catch (error) {
        info += `\nНе удалось получить информацию ELF: ${error.message}\n`;
      }
    }
    
    vscode.window.showInformationMessage(info, { modal: true });
    this.outputChannel.appendLine(info);
    this.outputChannel.show();
  }

  /**
   * Быстрая прошивка (без подтверждений)
   */
  async quickFlash() {
    // Всегда выполняем сборку
    const buildSuccess = await this.buildManager.build();
    if (!buildSuccess) {
      vscode.window.showErrorMessage('Сборка не удалась. Прошивка отменена.');
      return false;
    }
    
    // После сборки находим файл прошивки
    const firmwarePath = await this.findFirmwareFile();
    
    if (!firmwarePath) {
      vscode.window.showErrorMessage('Прошивка не найдена после сборки');
      return false;
    }
    
    try {
      this.outputChannel.clear();
      this.outputChannel.show();
      
      const programmerPath = this.configManager.projectConfig.programmerPath;
      const fileExt = path.extname(firmwarePath).toLowerCase();
      
      let command;
      if (fileExt === '.hex') {
        command = `"${programmerPath}" -c port=SWD -w "${firmwarePath}" -v -rst`;
      } else {
        command = `"${programmerPath}" -c port=SWD -w "${firmwarePath}" 0x08000000 -v -rst`;
      }
      
      await execCommand(
        command,
        'Быстрая прошивка',
        this.workspacePath,
        this.configManager.projectConfig,
        this.outputChannel
      );
      
      vscode.window.showInformationMessage('Быстрая прошивка завершена!');
      return true;
    } catch (error) {
      console.error('Ошибка быстрой прошивки:', error);
      vscode.window.showErrorMessage(`Ошибка быстрой прошивки: ${error.message}`);
      this.outputChannel.show();
      return false;
    }
  }
}

module.exports = FlashManager;