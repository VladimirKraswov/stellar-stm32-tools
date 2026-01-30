// managers/MonitorManager.js
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { 
  runInTerminal, 
  execCommand, 
  checkPython, 
  installPyserial, 
  startPythonMonitor, 
  startBufferedPythonMonitor 
} = require('../utils');

class MonitorManager {
  constructor(workspacePath, configManager, outputChannel, connectionManager) {
    this.workspacePath = workspacePath;
    this.configManager = configManager;
    this.outputChannel = outputChannel;
    this.connectionManager = connectionManager;
    this.currentPlatform = configManager.currentPlatform;
    
    this.monitorTerminal = null;
    this.isMonitoring = false;
    this.currentPort = null;
    this.currentBaudRate = null;
    this.monitorMode = null;
    this.monitorStartTime = null;
  }

  /**
   * Умный мониторинг - автоматический выбор порта и запуск
   */
  async smartMonitor() {
    try {
      // Проверяем Python и pyserial
      const pythonCheck = await this.checkPythonAndPyserial();
      if (!pythonCheck.installed) {
        await this.handlePythonNotInstalled(pythonCheck);
        return false;
      }
      
      // Находим и выбираем порт
      const selectedPort = await this.connectionManager.findAndSelectPort();
      if (!selectedPort) {
        vscode.window.showErrorMessage('Порт не выбран');
        return false;
      }
      
      console.log(`Выбран порт: ${selectedPort}`);
      
      // Обновляем конфигурацию, если порт изменился
      if (selectedPort !== this.configManager.projectConfig.serialPort) {
        this.configManager.projectConfig.serialPort = selectedPort;
        this.configManager.saveConfig();
      }
      
      // Выбираем режим мониторинга
      const mode = await this.selectMonitorMode();
      if (!mode) {
        return false;
      }
      
      // Останавливаем предыдущий монитор
      await this.stopMonitor();
      
      // Запускаем монитор в выбранном режиме
      return await this.startMonitor(selectedPort, mode);
      
    } catch (error) {
      console.error('Ошибка запуска монитора:', error);
      vscode.window.showErrorMessage(`Ошибка запуска монитора: ${error.message}`);
      return false;
    }
  }

  /**
   * Проверка Python и pyserial
   */
  async checkPythonAndPyserial() {
    return await checkPython();
  }

  /**
   * Обработка ситуации, когда Python не установлен
   */
  async handlePythonNotInstalled(pythonCheck) {
    const installChoice = await vscode.window.showWarningMessage(
      pythonCheck.message,
      'Установить pyserial',
      'Проверить Python',
      'Отмена'
    );
    
    if (installChoice === 'Установить pyserial') {
      try {
        await installPyserial(this.workspacePath, this.outputChannel);
        const newCheck = await checkPython();
        if (!newCheck.installed) {
          vscode.window.showErrorMessage('Установка не удалась. Проверьте вручную.');
          return false;
        }
        return true;
      } catch (error) {
        vscode.window.showErrorMessage(`Ошибка установки: ${error.message}`);
        return false;
      }
    } else if (installChoice === 'Проверить Python') {
      await this.checkPythonInstallation();
      return false;
    } else {
      return false;
    }
  }

  /**
   * Выбор режима мониторинга
   */
  async selectMonitorMode() {
    const modes = [
      { 
        label: 'Стандартный монитор', 
        description: 'Очищает буфер, показывает новые данные',
        mode: 'standard'
      },
      { 
        label: 'Монитор с буфером', 
        description: 'Показывает логи загрузки МК',
        mode: 'buffered'
      },
      { 
        label: 'RAW режим', 
        description: 'Без обработки, показывает все данные',
        mode: 'raw'
      },
      { 
        label: 'Только ошибки', 
        description: 'Фильтрует только ошибки и предупреждения',
        mode: 'errors'
      }
    ];
    
    const choice = await vscode.window.showQuickPick(
      modes,
      { 
        placeHolder: 'Выберите режим мониторинга',
        matchOnDescription: true
      }
    );
    
    return choice ? choice.mode : null;
  }

  /**
   * Запуск монитора на указанном порту
   */
  async startMonitor(port, mode = 'standard') {
    try {
      const baudRate = this.configManager.projectConfig.baudRate;
      const terminalName = this.getTerminalName(mode);
      
      console.log(`Запуск монитора: порт=${port}, скорость=${baudRate}, режим=${mode}`);
      
      let terminal;
      
      switch (mode) {
        case 'buffered':
          terminal = await startBufferedPythonMonitor(
            port,
            baudRate,
            terminalName,
            this.workspacePath,
            this.configManager.projectConfig,
            this.outputChannel
          );
          break;
          
        case 'standard':
        default:
          terminal = await startPythonMonitor(
            port,
            baudRate,
            terminalName,
            this.workspacePath,
            this.configManager.projectConfig,
            this.outputChannel,
            { 
              clearBuffer: true,
              timestamp: true,
              showPortInfo: true
            }
          );
          break;
      }
      
      if (terminal) {
        this.monitorTerminal = terminal;
        this.isMonitoring = true;
        this.currentPort = port;
        this.currentBaudRate = baudRate;
        this.monitorMode = mode;
        this.monitorStartTime = new Date();
        
        // Настраиваем обработчики событий терминала
        this.setupTerminalEventHandlers(terminal);
        
        // Сохраняем информацию о сессии
        this.saveMonitorSessionInfo();
        
        vscode.window.showInformationMessage(
          `Монитор запущен на порту ${port} (${baudRate} бод)`,
          'Остановить монитор',
          'Сменить порт',
          'Информация'
        ).then(choice => {
          if (choice === 'Остановить монитор') {
            this.stopMonitor();
          } else if (choice === 'Сменить порт') {
            this.restartMonitorWithNewPort();
          } else if (choice === 'Информация') {
            this.showMonitorInfo();
          }
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Ошибка запуска монитора:', error);
      vscode.window.showErrorMessage(`Ошибка запуска монитора: ${error.message}`);
      return false;
    }
  }

  /**
   * Получение имени терминала для режима
   */
  getTerminalName(mode) {
    const modeNames = {
      'standard': 'Монитор',
      'buffered': 'Монитор с буфером',
      'raw': 'RAW монитор',
      'errors': 'Монитор ошибок'
    };
    
    return modeNames[mode] || 'Монитор';
  }

  /**
   * Настройка обработчиков событий терминала
   */
  setupTerminalEventHandlers(terminal) {
    // Сохраняем ссылку на оригинальный dispose
    const originalDispose = terminal.dispose;
    
    terminal.dispose = () => {
      this.handleTerminalDisposed();
      originalDispose.call(terminal);
    };
    
    // Обработка закрытия терминала пользователем
    vscode.window.onDidCloseTerminal((closedTerminal) => {
      if (closedTerminal === terminal) {
        this.handleTerminalDisposed();
      }
    });
  }

  /**
   * Обработка закрытия терминала
   */
  handleTerminalDisposed() {
    if (this.isMonitoring) {
      console.log('Монитор остановлен (терминал закрыт)');
      this.isMonitoring = false;
      this.monitorTerminal = null;
      this.monitorMode = null;
      
      // Сохраняем статистику сессии
      this.saveMonitorSessionStats();
    }
  }

  /**
   * Остановка монитора
   */
  async stopMonitor() {
    if (this.monitorTerminal) {
      try {
        // Отправляем команду выхода (Ctrl+C)
        if (this.monitorTerminal.sendText) {
          // Для Python скрипта отправляем Ctrl+C
          this.monitorTerminal.sendText('\x03'); // Ctrl+C
          
          // Даем время на обработку
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Закрываем терминал
        this.monitorTerminal.dispose();
        this.monitorTerminal = null;
        
      } catch (e) {
        console.log('Ошибка при остановке монитора:', e);
      }
    }
    
    this.isMonitoring = false;
    this.currentPort = null;
    this.currentBaudRate = null;
    this.monitorMode = null;
    
    vscode.window.showInformationMessage('Монитор остановлен');
    
    return true;
  }

  /**
   * Перезапуск монитора с другим портом
   */
  async restartMonitorWithNewPort() {
    // Останавливаем текущий монитор
    await this.stopMonitor();
    
    // Ждем немного
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Запускаем умный монитор для выбора нового порта
    await this.smartMonitor();
  }

  /**
   * Показать информацию о мониторе
   */
  async showMonitorInfo() {
    if (!this.isMonitoring || !this.currentPort) {
      vscode.window.showInformationMessage('Монитор не запущен');
      return;
    }
    
    const sessionDuration = this.monitorStartTime 
      ? Math.floor((new Date() - this.monitorStartTime) / 1000)
      : 0;
    
    const hours = Math.floor(sessionDuration / 3600);
    const minutes = Math.floor((sessionDuration % 3600) / 60);
    const seconds = sessionDuration % 60;
    
    const durationStr = hours > 0 
      ? `${hours}ч ${minutes}м ${seconds}с`
      : minutes > 0
        ? `${minutes}м ${seconds}с`
        : `${seconds}с`;
    
    const info = `=== Информация о мониторе ===\n\n` +
      `Порт: ${this.currentPort}\n` +
      `Скорость: ${this.currentBaudRate} бод\n` +
      `Режим: ${this.monitorMode}\n` +
      `Длительность сессии: ${durationStr}\n` +
      `Статус: ${this.isMonitoring ? 'активен' : 'остановлен'}\n\n` +
      `Для остановки монитора закройте терминал или выполните команду "Остановить монитор".`;
    
    vscode.window.showInformationMessage(info, { modal: true });
    this.outputChannel.appendLine(info);
  }

  /**
   * Сохранение информации о сессии монитора
   */
  saveMonitorSessionInfo() {
    if (!this.workspacePath) return;
    
    const sessionInfo = {
      port: this.currentPort,
      baudRate: this.currentBaudRate,
      mode: this.monitorMode,
      startTime: this.monitorStartTime ? this.monitorStartTime.toISOString() : null,
      platform: this.currentPlatform,
      projectName: this.configManager.projectConfig.projectName
    };
    
    const sessionPath = path.join(this.workspacePath, '.stm32-monitor-session.json');
    
    try {
      fs.writeFileSync(
        sessionPath,
        JSON.stringify(sessionInfo, null, 2),
        'utf8'
      );
      console.log('Информация о сессии монитора сохранена');
    } catch (error) {
      console.error('Ошибка сохранения информации о сессии:', error);
    }
  }

  /**
   * Сохранение статистики сессии монитора
   */
  saveMonitorSessionStats() {
    if (!this.workspacePath || !this.monitorStartTime) return;
    
    const endTime = new Date();
    const sessionDuration = Math.floor((endTime - this.monitorStartTime) / 1000);
    
    const stats = {
      port: this.currentPort,
      baudRate: this.currentBaudRate,
      mode: this.monitorMode,
      startTime: this.monitorStartTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: sessionDuration,
      projectName: this.configManager.projectConfig.projectName
    };
    
    // Загружаем историю
    const historyPath = path.join(this.workspacePath, '.stm32-monitor-history.json');
    let history = [];
    
    if (fs.existsSync(historyPath)) {
      try {
        const historyData = fs.readFileSync(historyPath, 'utf8');
        history = JSON.parse(historyData);
      } catch (error) {
        console.error('Ошибка загрузки истории монитора:', error);
      }
    }
    
    // Добавляем текущую сессию
    history.push(stats);
    
    // Ограничиваем историю 100 записями
    if (history.length > 100) {
      history = history.slice(-100);
    }
    
    // Сохраняем историю
    try {
      fs.writeFileSync(
        historyPath,
        JSON.stringify(history, null, 2),
        'utf8'
      );
      console.log('Статистика сессии монитора сохранена');
    } catch (error) {
      console.error('Ошибка сохранения статистики монитора:', error);
    }
  }

  /**
   * Проверка установки Python
   */
  async checkPythonInstallation() {
    const terminal = await runInTerminal(
      '', 
      'Проверка Python', 
      this.workspacePath, 
      this.configManager.projectConfig, 
      this.outputChannel
    );
    
    const commands = [
      'echo "=== Проверка Python ==="',
      'echo ""',
      'echo "1. Проверка Python 3:"',
      'python3 --version 2>/dev/null || echo "Python 3 не найден"',
      'echo ""',
      'echo "2. Проверка Python:"',
      'python --version 2>/dev/null || echo "Python не найден"',
      'echo ""',
      'echo "3. Проверка pyserial:"',
      'python3 -c "import serial; print(serial.__version__)" 2>/dev/null || python -c "import serial; print(serial.__version__)" 2>/dev/null || echo "pyserial не установлен"',
      'echo ""',
      'echo "4. Путь к Python:"',
      'which python3 2>/dev/null || which python 2>/dev/null || echo "Python не в PATH"',
      'echo ""',
      'echo "=== Установка ==="',
      'echo "Для установки pyserial выполните:"',
      'echo "pip install pyserial"',
      'echo "или"',
      'echo "pip3 install pyserial"'
    ];
    
    commands.forEach(cmd => terminal.sendText(cmd));
  }

  /**
   * Запуск монитора (прямой запуск, без выбора порта)
   */
  async monitor() {
    // Если монитор уже запущен, показываем информацию
    if (this.isMonitoring) {
      this.showMonitorInfo();
      return true;
    }
    
    // Используем порт из конфигурации
    const port = this.configManager.projectConfig.serialPort;
    if (!port) {
      // Если порт не настроен, запускаем умный монитор
      return await this.smartMonitor();
    }
    
    // Запускаем монитор на настроенном порту
    return await this.startMonitor(port, 'standard');
  }

  /**
   * Сброс монитора (перезапуск)
   */
  async resetMonitor() {
    vscode.window.showInformationMessage('Перезапуск монитора...');
    
    const currentPort = this.currentPort;
    const currentMode = this.monitorMode;
    
    await this.stopMonitor();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (currentPort) {
      await this.startMonitor(currentPort, currentMode || 'standard');
    } else {
      await this.smartMonitor();
    }
  }

  /**
   * Изменение скорости передачи (baud rate)
   */
  async changeBaudRate() {
    const currentBaudRate = this.configManager.projectConfig.baudRate;
    
    const baudRates = [
      '9600', '19200', '38400', '57600', '115200', 
      '230400', '460800', '921600', '1000000', '2000000'
    ];
    
    const selected = await vscode.window.showQuickPick(
      baudRates.map(rate => ({
        label: rate,
        description: rate === currentBaudRate.toString() ? 'текущая' : '',
        detail: `Бод`
      })),
      {
        placeHolder: 'Выберите скорость передачи',
        matchOnDescription: true
      }
    );
    
    if (selected) {
      const newBaudRate = parseInt(selected.label);
      this.configManager.projectConfig.baudRate = newBaudRate;
      this.configManager.saveConfig();
      
      vscode.window.showInformationMessage(`Скорость передачи изменена на ${newBaudRate} бод`);
      
      // Перезапускаем монитор если он активен
      if (this.isMonitoring) {
        const restart = await vscode.window.showInformationMessage(
          `Перезапустить монитор с новой скоростью ${newBaudRate} бод?`,
          'Перезапустить',
          'Оставить'
        );
        
        if (restart === 'Перезапустить') {
          await this.resetMonitor();
        }
      }
    }
  }

  /**
   * Отправка команды в монитор
   */
  async sendCommandToMonitor() {
    if (!this.isMonitoring || !this.monitorTerminal) {
      vscode.window.showWarningMessage('Монитор не запущен');
      return;
    }
    
    const command = await vscode.window.showInputBox({
      prompt: 'Введите команду для отправки в монитор',
      placeHolder: 'Например: help, info, reset'
    });
    
    if (command) {
      // Отправляем команду в терминал
      this.monitorTerminal.sendText(command + '\n');
      
      this.outputChannel.appendLine(`[Отправлено] ${command}`);
    }
  }

  /**
   * Очистка экрана монитора
   */
  async clearMonitorScreen() {
    if (!this.isMonitoring || !this.monitorTerminal) {
      vscode.window.showWarningMessage('Монитор не запущен');
      return;
    }
    
    // Отправляем команду очистки экрана
    this.monitorTerminal.sendText('\x1B[2J\x1B[0f'); // ANSI escape codes для очистки
    
    vscode.window.showInformationMessage('Экран монитора очищен');
  }

  /**
   * Сохранение логов монитора в файл
   */
  async saveMonitorLogs() {
    if (!this.workspacePath) {
      vscode.window.showErrorMessage('Не открыта рабочая папка');
      return;
    }
    
    // Предлагаем выбрать имя файла
    const fileName = await vscode.window.showInputBox({
      prompt: 'Имя файла для сохранения логов',
      value: `monitor_log_${new Date().toISOString().slice(0, 10)}.txt`,
      validateInput: (value) => {
        if (!value || value.trim() === '') {
          return 'Имя файла не может быть пустым';
        }
        if (!value.endsWith('.txt') && !value.endsWith('.log')) {
          return 'Файл должен иметь расширение .txt или .log';
        }
        return null;
      }
    });
    
    if (!fileName) return;
    
    const filePath = path.join(this.workspacePath, fileName);
    
    // Пока не можем получить содержимое терминала напрямую,
    // поэтому предлагаем ручное копирование или используем буфер обмена
    
    vscode.window.showInformationMessage(
      `Для сохранения логов скопируйте содержимое терминала и вставьте в файл ${fileName}`,
      'Открыть файл'
    ).then(choice => {
      if (choice === 'Открыть файл') {
        // Создаем пустой файл и открываем его
        fs.writeFileSync(filePath, 'Логи монитора будут сохранены здесь\n\n', 'utf8');
        vscode.workspace.openTextDocument(filePath).then(doc => {
          vscode.window.showTextDocument(doc);
        });
      }
    });
  }

  /**
   * Настройка монитора (параметры)
   */
  async configureMonitor() {
    const config = this.configManager.projectConfig;
    
    const options = [
      {
        label: 'Скорость передачи (baud rate)',
        description: `Текущая: ${config.baudRate}`,
        command: 'changeBaudRate'
      },
      {
        label: 'Автоматический запуск монитора',
        description: config.autoStartMonitor ? 'Включено' : 'Выключено',
        command: 'toggleAutoStart'
      },
      {
        label: 'Очистка буфера при старте',
        description: config.clearBufferOnStart ? 'Включено' : 'Выключено',
        command: 'toggleClearBuffer'
      },
      {
        label: 'Показывать временные метки',
        description: config.showTimestamps ? 'Включено' : 'Выключено',
        command: 'toggleTimestamps'
      }
    ];
    
    const selected = await vscode.window.showQuickPick(
      options,
      {
        placeHolder: 'Выберите параметр для настройки'
      }
    );
    
    if (selected) {
      // Обрабатываем выбор
      switch (selected.command) {
        case 'changeBaudRate':
          await this.changeBaudRate();
          break;
        case 'toggleAutoStart':
          config.autoStartMonitor = !config.autoStartMonitor;
          this.configManager.saveConfig();
          vscode.window.showInformationMessage(
            `Автоматический запуск монитора: ${config.autoStartMonitor ? 'включен' : 'выключен'}`
          );
          break;
        case 'toggleClearBuffer':
          config.clearBufferOnStart = !config.clearBufferOnStart;
          this.configManager.saveConfig();
          vscode.window.showInformationMessage(
            `Очистка буфера при старте: ${config.clearBufferOnStart ? 'включена' : 'выключена'}`
          );
          break;
        case 'toggleTimestamps':
          config.showTimestamps = !config.showTimestamps;
          this.configManager.saveConfig();
          vscode.window.showInformationMessage(
            `Временные метки: ${config.showTimestamps ? 'включены' : 'выключены'}`
          );
          break;
      }
    }
  }

  /**
   * Тестирование порта мониторинга
   */
  async testMonitorPort(port = null) {
    const targetPort = port || this.configManager.projectConfig.serialPort;
    
    if (!targetPort) {
      vscode.window.showErrorMessage('Порт не указан');
      return false;
    }
    
    try {
      const terminal = await runInTerminal(
        '', 
        'Тест порта', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      const baudRate = this.configManager.projectConfig.baudRate;
      
      terminal.sendText(`echo "=== Тестирование порта ${targetPort} ==="`);
      terminal.sendText(`echo "Скорость: ${baudRate} бод"`);
      terminal.sendText(`echo ""`);
      
      // Создаем простой Python скрипт для тестирования
      const testScript = `python3 -c "
import serial
import sys
import time

try:
    print(f'Попытка подключения к {sys.argv[1]} с скоростью {sys.argv[2]}...')
    ser = serial.Serial(sys.argv[1], int(sys.argv[2]), timeout=2)
    print('✅ Порт открыт успешно')
    print(f'Настройки порта:')
    print(f'  - Имя: {ser.name}')
    print(f'  - Baudrate: {ser.baudrate}')
    print(f'  - Timeout: {ser.timeout}')
    print(f'  - Bytesize: {ser.bytesize}')
    print(f'  - Parity: {ser.parity}')
    print(f'  - Stopbits: {ser.stopbits}')
    
    print('\\nПроверка чтения данных (таймаут 2 секунды)...')
    start_time = time.time()
    while time.time() - start_time < 2:
        if ser.in_waiting > 0:
            data = ser.read(ser.in_waiting)
            print(f'Получено данных: {len(data)} байт')
            if len(data) > 0:
                print(f'Первые 100 байт: {data[:100]}')
            break
        time.sleep(0.1)
    else:
        print('⚠ Данные не получены (таймаут)')
    
    ser.close()
    print('✅ Порт закрыт')
    
except serial.SerialException as e:
    print(f'❌ Ошибка: {e}')
    sys.exit(1)
except Exception as e:
    print(f'❌ Неожиданная ошибка: {e}')
    sys.exit(1)
" "${targetPort}" "${baudRate}"`;
      
      terminal.sendText(testScript);
      
      return true;
    } catch (error) {
      console.error('Ошибка тестирования порта:', error);
      vscode.window.showErrorMessage(`Ошибка тестирования порта: ${error.message}`);
      return false;
    }
  }

  /**
   * Показать историю сессий мониторинга
   */
  async showMonitorHistory() {
    if (!this.workspacePath) {
      vscode.window.showErrorMessage('Не открыта рабочая папка');
      return;
    }
    
    const historyPath = path.join(this.workspacePath, '.stm32-monitor-history.json');
    
    if (!fs.existsSync(historyPath)) {
      vscode.window.showInformationMessage('История мониторинга пуста');
      return;
    }
    
    try {
      const historyData = fs.readFileSync(historyPath, 'utf8');
      const history = JSON.parse(historyData);
      
      if (history.length === 0) {
        vscode.window.showInformationMessage('История мониторинга пуста');
        return;
      }
      
      // Формируем текст истории
      let historyText = '=== История сессий мониторинга ===\n\n';
      
      // Сортируем по времени (новые сверху)
      const sortedHistory = [...history].reverse();
      
      sortedHistory.forEach((session, index) => {
        const startTime = new Date(session.startTime).toLocaleString();
        const duration = this.formatDuration(session.duration);
        
        historyText += `${index + 1}. ${startTime}\n`;
        historyText += `   Порт: ${session.port}\n`;
        historyText += `   Скорость: ${session.baudRate} бод\n`;
        historyText += `   Длительность: ${duration}\n`;
        historyText += `   Режим: ${session.mode || 'стандартный'}\n`;
        historyText += `   Проект: ${session.projectName || 'не указан'}\n`;
        historyText += '\n';
      });
      
      historyText += `Всего сессий: ${history.length}`;
      
      vscode.window.showInformationMessage(historyText, { modal: true });
      this.outputChannel.appendLine(historyText);
      this.outputChannel.show();
      
    } catch (error) {
      console.error('Ошибка чтения истории мониторинга:', error);
      vscode.window.showErrorMessage('Ошибка чтения истории мониторинга');
    }
  }

  /**
   * Форматирование длительности
   */
  formatDuration(seconds) {
    if (!seconds) return 'неизвестно';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}ч ${minutes}м ${secs}с`;
    } else if (minutes > 0) {
      return `${minutes}м ${secs}с`;
    } else {
      return `${secs}с`;
    }
  }

  /**
   * Проверка статуса монитора
   */
  getMonitorStatus() {
    return {
      isMonitoring: this.isMonitoring,
      port: this.currentPort,
      baudRate: this.currentBaudRate,
      mode: this.monitorMode,
      startTime: this.monitorStartTime,
      duration: this.monitorStartTime 
        ? Math.floor((new Date() - this.monitorStartTime) / 1000)
        : 0,
      terminal: this.monitorTerminal ? 'активен' : 'не активен'
    };
  }

  /**
   * Запуск монитора с фильтром
   */
  async startFilteredMonitor(filter) {
    if (!filter) {
      filter = await vscode.window.showInputBox({
        prompt: 'Введите фильтр (регулярное выражение)',
        placeHolder: 'Например: ERROR|WARNING|info:'
      });
      
      if (!filter) return;
    }
    
    // Останавливаем текущий монитор
    await this.stopMonitor();
    
    // Находим порт
    const selectedPort = await this.connectionManager.findAndSelectPort();
    if (!selectedPort) {
      vscode.window.showErrorMessage('Порт не выбран');
      return false;
    }
    
    // Запускаем Python скрипт с фильтром
    const baudRate = this.configManager.projectConfig.baudRate;
    const script = `
import serial
import re
import sys

port = '${selectedPort}'
baud = ${baudRate}
filter_pattern = re.compile(r'${filter}')

try:
    ser = serial.Serial(port, baud, timeout=None)
    print(f'🚀 Монитор запущен с фильтром: {filter}')
    print(f'📡 Порт: {port}, скорость: {baud}')
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    while True:
        try:
            line = ser.readline().decode('utf-8', errors='ignore').rstrip()
            if line and filter_pattern.search(line):
                print(f'[{time.strftime("%H:%M:%S")}] {line}')
        except KeyboardInterrupt:
            print('\\n🛑 Монитор остановлен')
            break
        except Exception as e:
            print(f'⚠ Ошибка: {e}')
            
    ser.close()
    
except serial.SerialException as e:
    print(f'❌ Ошибка открытия порта: {e}')
except Exception as e:
    print(f'❌ Неожиданная ошибка: {e}')
`;
    
    try {
      const terminal = vscode.window.createTerminal({
        name: 'Монитор с фильтром',
        cwd: this.workspacePath
      });
      
      terminal.show();
      terminal.sendText(`python3 -c "${script.replace(/\n/g, '; ')}"`);
      
      this.monitorTerminal = terminal;
      this.isMonitoring = true;
      this.currentPort = selectedPort;
      this.currentBaudRate = baudRate;
      this.monitorMode = 'filtered';
      this.monitorStartTime = new Date();
      
      this.setupTerminalEventHandlers(terminal);
      
      vscode.window.showInformationMessage(`Монитор запущен с фильтром: ${filter}`);
      
    } catch (error) {
      console.error('Ошибка запуска фильтрованного монитора:', error);
      vscode.window.showErrorMessage(`Ошибка запуска монитора: ${error.message}`);
      return false;
    }
    
    return true;
  }

  /**
   * Экспорт настроек монитора
   */
  async exportMonitorSettings() {
    if (!this.workspacePath) {
      vscode.window.showErrorMessage('Не открыта рабочая папка');
      return;
    }
    
    const settings = {
      port: this.configManager.projectConfig.serialPort,
      baudRate: this.configManager.projectConfig.baudRate,
      clearBufferOnStart: this.configManager.projectConfig.clearBufferOnStart,
      monitorTimeout: this.configManager.projectConfig.monitorTimeout,
      preferredMonitor: this.configManager.projectConfig.preferredMonitor,
      showTimestamps: this.configManager.projectConfig.showTimestamps || true,
      autoStartMonitor: this.configManager.projectConfig.autoStartMonitor || false,
      exportDate: new Date().toISOString(),
      projectName: this.configManager.projectConfig.projectName
    };
    
    const settingsJson = JSON.stringify(settings, null, 2);
    
    const fileName = `monitor_settings_${new Date().toISOString().slice(0, 10)}.json`;
    const filePath = path.join(this.workspacePath, fileName);
    
    try {
      fs.writeFileSync(filePath, settingsJson, 'utf8');
      
      vscode.window.showInformationMessage(
        `Настройки монитора экспортированы в ${fileName}`,
        'Открыть файл'
      ).then(choice => {
        if (choice === 'Открыть файл') {
          vscode.workspace.openTextDocument(filePath).then(doc => {
            vscode.window.showTextDocument(doc);
          });
        }
      });
      
    } catch (error) {
      console.error('Ошибка экспорта настроек:', error);
      vscode.window.showErrorMessage(`Ошибка экспорта настроек: ${error.message}`);
    }
  }
}

module.exports = MonitorManager;