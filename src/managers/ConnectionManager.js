// managers/ConnectionManager.js
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execCommand, runInTerminal, findSerialPorts, findAllSerialPorts, testSerialPort } = require('../utils');

class ConnectionManager {
  constructor(configManager, outputChannel, workspacePath = null) {
    this.configManager = configManager;
    this.outputChannel = outputChannel;
    this.workspacePath = workspacePath;
    this.currentPlatform = configManager.currentPlatform;
    this.connectedDevices = [];
  }

  /**
   * Сканирование всех последовательных портов
   */
  async scanAllPorts() {
    try {
      this.outputChannel.appendLine('=== Сканирование последовательных портов ===');
      
      const allPorts = await findAllSerialPorts();
      this.connectedDevices = allPorts;
      
      if (allPorts.length === 0) {
        vscode.window.showInformationMessage('Последовательные порты не найдены на этой системе');
        this.outputChannel.appendLine('❌ Последовательные порты не найдены');
        return [];
      }
      
      // Формируем список для отображения
      const portList = allPorts.map(p => `• ${p}`).join('\n');
      
      vscode.window.showInformationMessage(
        `Найдено ${allPorts.length} порт(ов):\n\n${portList}`,
        { modal: true }
      );
      
      this.outputChannel.appendLine(`✅ Найдено ${allPorts.length} порт(ов):`);
      allPorts.forEach((port, index) => {
        this.outputChannel.appendLine(`  ${index + 1}. ${port}`);
      });
      
      this.outputChannel.show();
      
      return allPorts;
    } catch (error) {
      console.error('Ошибка сканирования портов:', error);
      vscode.window.showErrorMessage(`Ошибка сканирования портов: ${error.message}`);
      return [];
    }
  }

  /**
   * Сканирование портов по шаблону из конфигурации
   */
  async scanPorts() {
    try {
      const pattern = this.configManager.projectConfig.serialPort || '*';
      this.outputChannel.appendLine(`=== Сканирование портов по шаблону: ${pattern} ===`);
      
      const ports = await findSerialPorts(pattern);
      
      if (ports.length === 0) {
        vscode.window.showInformationMessage(
          `Порты по шаблону "${pattern}" не найдены`,
          'Сканировать все порты'
        ).then(choice => {
          if (choice === 'Сканировать все порты') {
            this.scanAllPorts();
          }
        });
        
        this.outputChannel.appendLine(`❌ Порты по шаблону "${pattern}" не найдены`);
        return [];
      }
      
      // Показываем найденные порты
      const portList = ports.map(p => `• ${p}`).join('\n');
      
      vscode.window.showInformationMessage(
        `Найдено ${ports.length} порт(ов) по шаблону "${pattern}":\n\n${portList}`,
        { modal: true }
      );
      
      this.outputChannel.appendLine(`✅ Найдено ${ports.length} порт(ов):`);
      ports.forEach((port, index) => {
        this.outputChannel.appendLine(`  ${index + 1}. ${port}`);
      });
      
      // Если нашли порт, обновляем конфигурацию
      if (ports.length > 0 && ports[0] !== this.configManager.projectConfig.serialPort) {
        this.configManager.projectConfig.serialPort = ports[0];
        this.configManager.saveConfig();
        this.outputChannel.appendLine(`📝 Обновлен шаблон порта в конфигурации: ${ports[0]}`);
      }
      
      this.outputChannel.show();
      return ports;
    } catch (error) {
      console.error('Ошибка сканирования портов:', error);
      vscode.window.showErrorMessage(`Ошибка сканирования портов: ${error.message}`);
      return [];
    }
  }

  /**
   * Тестирование подключения к порту
   */
  async testPortConnection(port = null) {
    try {
      const targetPort = port || this.configManager.projectConfig.serialPort;
      
      if (!targetPort) {
        vscode.window.showErrorMessage('Порт не указан. Укажите порт или выполните сканирование.');
        return false;
      }
      
      this.outputChannel.appendLine(`=== Тестирование подключения к порту: ${targetPort} ===`);
      
      const result = await testSerialPort(targetPort);
      
      if (result.success) {
        vscode.window.showInformationMessage(
          `✅ Порт ${targetPort} доступен!\n${result.message}`,
          { modal: true }
        );
        this.outputChannel.appendLine(`✅ ${result.message}`);
        return true;
      } else {
        vscode.window.showErrorMessage(
          `❌ Порт ${targetPort} недоступен:\n${result.message}`,
          { modal: true }
        );
        this.outputChannel.appendLine(`❌ ${result.message}`);
        return false;
      }
    } catch (error) {
      console.error('Ошибка тестирования порта:', error);
      vscode.window.showErrorMessage(`Ошибка тестирования порта: ${error.message}`);
      return false;
    }
  }

  /**
   * Тестирование всех найденных портов
   */
  async testAllPorts() {
    try {
      this.outputChannel.appendLine('=== Тестирование всех портов ===');
      
      const allPorts = await findAllSerialPorts();
      
      if (allPorts.length === 0) {
        vscode.window.showInformationMessage('Нет портов для тестирования');
        return [];
      }
      
      const results = [];
      
      for (const port of allPorts) {
        this.outputChannel.appendLine(`\n🔍 Тестирование порта: ${port}`);
        
        try {
          const result = await testSerialPort(port);
          results.push({ port, ...result });
          
          if (result.success) {
            this.outputChannel.appendLine(`  ✅ ${result.message}`);
          } else {
            this.outputChannel.appendLine(`  ❌ ${result.message}`);
          }
        } catch (error) {
          this.outputChannel.appendLine(`  ❌ Ошибка: ${error.message}`);
          results.push({ port, success: false, message: `Ошибка: ${error.message}` });
        }
      }
      
      // Показываем сводку
      const workingPorts = results.filter(r => r.success);
      const failedPorts = results.filter(r => !r.success);
      
      let summary = `=== Результаты тестирования портов ===\n\n`;
      summary += `Всего портов: ${allPorts.length}\n`;
      summary += `Рабочих портов: ${workingPorts.length}\n`;
      summary += `Недоступных портов: ${failedPorts.length}\n\n`;
      
      if (workingPorts.length > 0) {
        summary += `✅ Рабочие порты:\n`;
        workingPorts.forEach(r => summary += `  • ${r.port}\n`);
      }
      
      if (failedPorts.length > 0) {
        summary += `\n❌ Недоступные порты:\n`;
        failedPorts.forEach(r => summary += `  • ${r.port}: ${r.message}\n`);
      }
      
      vscode.window.showInformationMessage(summary, { modal: true });
      this.outputChannel.appendLine(`\n${summary}`);
      this.outputChannel.show();
      
      return results;
    } catch (error) {
      console.error('Ошибка тестирования всех портов:', error);
      vscode.window.showErrorMessage(`Ошибка тестирования всех портов: ${error.message}`);
      return [];
    }
  }

  /**
   * Список подключенных устройств
   */
  async listDevices() {
    try {
      const terminal = await runInTerminal(
        '', 
        'Устройства', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      terminal.sendText('echo "=== Подключенные устройства STM32 ==="');
      terminal.sendText('echo ""');
      
      // Сканируем последовательные порты
      terminal.sendText('echo "1. Последовательные порты:"');
      
      if (this.currentPlatform === 'win32') {
        terminal.sendText('powershell -Command "Get-WMIObject Win32_SerialPort | Select-Object DeviceID, Caption, Description | Format-Table -AutoSize"');
        terminal.sendText('echo ""');
        terminal.sendText('echo "Дополнительно:"');
        terminal.sendText('powershell -Command "[System.IO.Ports.SerialPort]::getportnames() | ForEach-Object { \\\"Порт: $_\\\" }"');
      } else if (this.currentPlatform === 'darwin') {
        terminal.sendText('ls /dev/tty.* /dev/cu.* 2>/dev/null | sort | xargs -I {} echo "Порт: {}"');
        terminal.sendText('echo ""');
        terminal.sendText('echo "USB устройства:"');
        terminal.sendText('system_profiler SPUSBDataType 2>/dev/null | grep -A 10 "STMicroelectronics" || echo "STM устройства не найдены"');
      } else {
        terminal.sendText('ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | sort | xargs -I {} echo "Порт: {}"');
        terminal.sendText('echo ""');
        terminal.sendText('echo "USB устройства:"');
        terminal.sendText('lsusb 2>/dev/null | grep -i stm || echo "STM устройства не найдены"');
      }
      
      terminal.sendText('echo ""');
      terminal.sendText('echo "2. ST-LINK устройства:"');
      
      // Проверяем программер
      const programmerPath = this.configManager.projectConfig.programmerPath;
      if (fs.existsSync(programmerPath)) {
        terminal.sendText(`"${programmerPath}" -l 2>&1 | head -30 || echo "Не удалось получить список ST-LINK устройств"`);
      } else {
        terminal.sendText(`echo "Программер не найден по пути: ${programmerPath}"`);
      }
      
      terminal.sendText('echo ""');
      
      if (this.currentPlatform !== 'win32') {
        terminal.sendText('echo "3. Активные сессии screen:"');
        terminal.sendText('screen -ls 2>/dev/null || echo "Нет активных сессий screen"');
      }
      
      terminal.sendText('echo ""');
      terminal.sendText('echo "4. Активные процессы мониторинга:"');
      terminal.sendText('ps aux | grep -E "(minicom|screen|putty|python.*serial)" | grep -v grep || echo "Нет активных процессов мониторинга"');
      
      return true;
    } catch (error) {
      console.error('Ошибка при получении списка устройств:', error);
      vscode.window.showErrorMessage(`Ошибка при получении списка устройств: ${error.message}`);
      return false;
    }
  }

  /**
   * Проверка подключения ST-LINK
   */
  async checkStLinkConnection() {
    try {
      this.outputChannel.appendLine('=== Проверка подключения ST-LINK ===');
      
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        const errorMsg = `Программер не найден по пути: ${programmerPath}`;
        vscode.window.showErrorMessage(errorMsg, 'Обновить путь');
        this.outputChannel.appendLine(`❌ ${errorMsg}`);
        
        // Предлагаем обновить путь
        vscode.window.showErrorMessage(errorMsg, 'Обновить путь').then(choice => {
          if (choice === 'Обновить путь') {
            vscode.commands.executeCommand('stm32.updatePaths');
          }
        });
        
        return false;
      }
      
      const terminal = await runInTerminal(
        '', 
        'Проверка ST-LINK', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      const commands = [
        'echo "Проверка ST-LINK подключения..."',
        'echo ""',
        `"${programmerPath}" -l 2>&1`,
        'echo ""',
        'echo "Если выше нет ошибок, ST-LINK подключен корректно."',
        'echo "Для прошивки используйте команду \\"STM32: Прошить устройство\\""'
      ];
      
      commands.forEach(cmd => terminal.sendText(cmd));
      
      return true;
    } catch (error) {
      console.error('Ошибка проверки ST-LINK:', error);
      vscode.window.showErrorMessage(`Ошибка проверки ST-LINK: ${error.message}`);
      return false;
    }
  }

  /**
   * Тестирование программера
   */
  async testProgrammer() {
    try {
      this.outputChannel.appendLine('=== Тестирование программера ===');
      
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        const errorMsg = `Программер не найден по пути: ${programmerPath}`;
        vscode.window.showErrorMessage(errorMsg);
        this.outputChannel.appendLine(`❌ ${errorMsg}`);
        return false;
      }
      
      const terminal = await runInTerminal(
        '', 
        'Тест программера', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      const commands = [
        'echo "Тестирование STM32_Programmer_CLI..."',
        'echo ""',
        `"${programmerPath}" --version 2>&1`,
        'echo ""',
        'echo "Если выше отображается версия программера, он работает корректно."'
      ];
      
      commands.forEach(cmd => terminal.sendText(cmd));
      
      return true;
    } catch (error) {
      console.error('Ошибка тестирования программера:', error);
      vscode.window.showErrorMessage(`Ошибка тестирования программера: ${error.message}`);
      return false;
    }
  }

  /**
   * Проверка соединения с МК
   */
  async checkMcuConnection() {
    try {
      this.outputChannel.appendLine('=== Проверка соединения с МК ===');
      
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      const terminal = await runInTerminal(
        '', 
        'Проверка МК', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      const commands = [
        'echo "Проверка связи с микроконтроллером через ST-LINK..."',
        'echo ""',
        `"${programmerPath}" -c port=SWD -r32 0x1FFF7A22 1 2>&1`,
        'echo ""',
        'echo "Если выше отображается значение регистра, МК подключен и отвечает."',
        'echo "Если есть ошибки, проверьте:"',
        'echo "  1. Подключен ли ST-LINK"',
        'echo "  2. Правильно ли подключены пины (SWDIO, SWCLK, GND)"',
        'echo "  3. Питается ли МК"'
      ];
      
      commands.forEach(cmd => terminal.sendText(cmd));
      
      return true;
    } catch (error) {
      console.error('Ошибка проверки соединения с МК:', error);
      vscode.window.showErrorMessage(`Ошибка проверки соединения с МК: ${error.message}`);
      return false;
    }
  }

  /**
   * Сброс МК
   */
  async resetMcu() {
    try {
      this.outputChannel.appendLine('=== Сброс МК ===');
      
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      const choice = await vscode.window.showWarningMessage(
        'Вы уверены, что хотите выполнить сброс микроконтроллера?',
        { modal: true },
        'Сбросить',
        'Отмена'
      );
      
      if (choice !== 'Сбросить') {
        return false;
      }
      
      const terminal = await runInTerminal(
        '', 
        'Сброс МК', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      const commands = [
        'echo "Выполнение сброса микроконтроллера..."',
        'echo ""',
        `"${programmerPath}" -c port=SWD -rst 2>&1`,
        'echo ""',
        'echo "Сброс выполнен. МК перезагружен."'
      ];
      
      commands.forEach(cmd => terminal.sendText(cmd));
      
      vscode.window.showInformationMessage('Микроконтроллер сброшен');
      return true;
    } catch (error) {
      console.error('Ошибка сброса МК:', error);
      vscode.window.showErrorMessage(`Ошибка сброса МК: ${error.message}`);
      return false;
    }
  }

  /**
   * Чтение защищенных регистров МК
   */
  async readMcuInfo() {
    try {
      this.outputChannel.appendLine('=== Чтение информации МК ===');
      
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      const terminal = await runInTerminal(
        '', 
        'Информация МК', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      const commands = [
        'echo "Чтение информации о микроконтроллере..."',
        'echo ""',
        'echo "1. ID микроконтроллера:"',
        `"${programmerPath}" -c port=SWD -r32 0x1FFF7A22 1 2>&1 | grep -i "0x"`,
        'echo ""',
        'echo "2. Серийный номер:"',
        `"${programmerPath}" -c port=SWD -r32 0x1FFF7A10 3 2>&1 | grep -i "0x"`,
        'echo ""',
        'echo "3. Размер Flash памяти:"',
        `"${programmerPath}" -c port=SWD -r32 0x1FFF7A22 1 2>&1 | grep -i "device" || echo "Определите по datasheet"`,
        'echo ""',
        'echo "4. Версия прошивки ST-LINK:"',
        `"${programmerPath}" --version 2>&1 | grep -i "ST-LINK"`,
        'echo ""',
        'echo "Для STM32F407:"',
        'echo "  - Flash: 1 МБ"',
        'echo "  - SRAM: 192 КБ"',
        'echo "  - CPU: Cortex-M4 168 МГц"'
      ];
      
      commands.forEach(cmd => terminal.sendText(cmd));
      
      return true;
    } catch (error) {
      console.error('Ошибка чтения информации МК:', error);
      vscode.window.showErrorMessage(`Ошибка чтения информации МК: ${error.message}`);
      return false;
    }
  }

  /**
   * Поиск и выбор порта для мониторинга
   */
  async findAndSelectPort() {
    try {
      this.outputChannel.appendLine('=== Поиск порта для мониторинга ===');
      
      // Сначала ищем по шаблону из конфигурации
      let ports = await findSerialPorts(this.configManager.projectConfig.serialPort);
      
      // Если не нашли, ищем все порты
      if (ports.length === 0) {
        ports = await findAllSerialPorts();
      }
      
      if (ports.length === 0) {
        const errorMsg = 
          `Последовательные порты не найдены.\n\n` +
          `Проверьте:\n` +
          `1. Устройство подключено\n` +
          `2. Драйверы установлены\n` +
          `3. Для macOS: проверьте Системная информация → USB\n` +
          `4. Для Windows: проверьте Диспетчер устройств`;
        
        vscode.window.showErrorMessage(errorMsg, { modal: true });
        return null;
      }
      
      let selectedPort = ports[0];
      
      // Если несколько портов, предлагаем выбрать
      if (ports.length > 1) {
        const quickPickItems = ports.map(p => ({
          label: path.basename(p),
          description: p,
          detail: p,
          port: p
        }));
        
        const choice = await vscode.window.showQuickPick(
          quickPickItems,
          {
            placeHolder: 'Выберите последовательный порт',
            matchOnDescription: true,
            matchOnDetail: true
          }
        );
        
        if (!choice) {
          return null;
        }
        
        selectedPort = choice.port || choice.detail || choice.description;
      }
      
      console.log(`Выбран порт: ${selectedPort}`);
      
      // Обновляем конфигурацию, если порт изменился
      if (selectedPort !== this.configManager.projectConfig.serialPort) {
        this.configManager.projectConfig.serialPort = selectedPort;
        this.configManager.saveConfig();
        this.outputChannel.appendLine(`📝 Обновлен порт в конфигурации: ${selectedPort}`);
      }
      
      return selectedPort;
    } catch (error) {
      console.error('Ошибка при выборе порта:', error);
      vscode.window.showErrorMessage(`Ошибка при выборе порта: ${error.message}`);
      return null;
    }
  }

  /**
   * Получение списка активных COM портов (для Windows)
   */
  async getWindowsComPorts() {
    if (this.currentPlatform !== 'win32') {
      return [];
    }
    
    try {
      const { execSync } = require('child_process');
      const result = execSync('powershell -Command "[System.IO.Ports.SerialPort]::getportnames()"', { encoding: 'utf8' });
      return result.split('\n').filter(port => port.trim() !== '').map(port => port.trim());
    } catch (error) {
      console.error('Ошибка получения COM портов Windows:', error);
      return [];
    }
  }

  /**
   * Получение детальной информации о порте
   */
  async getPortInfo(port) {
    if (!port) return null;
    
    try {
      let info = `Информация о порте: ${port}\n\n`;
      
      if (this.currentPlatform === 'win32') {
        const { execSync } = require('child_process');
        try {
          const result = execSync(
            `powershell -Command "Get-WMIObject Win32_SerialPort | Where-Object {\\$_.DeviceID -eq '${port}'} | Select-Object Caption, Description, Status, Name | Format-List"`,
            { encoding: 'utf8' }
          );
          info += result;
        } catch (e) {
          info += 'Не удалось получить детальную информацию\n';
        }
      } else if (this.currentPlatform === 'darwin') {
        info += `Для macOS используйте команду: system_profiler SPUSBDataType\n`;
        info += `или посмотрите в Системная информация → USB\n`;
      } else {
        // Linux
        const deviceName = path.basename(port);
        const { execSync } = require('child_process');
        try {
          const udevInfo = execSync(`udevadm info -q property -n ${port} 2>/dev/null || echo ""`, { encoding: 'utf8' });
          info += udevInfo;
        } catch (e) {
          info += 'Не удалось получить информацию udev\n';
        }
      }
      
      // Тестируем порт
      info += '\nТестирование порта:\n';
      try {
        const testResult = await testSerialPort(port);
        info += testResult.success ? '✅ Порт доступен\n' : `❌ Порт недоступен: ${testResult.message}\n`;
      } catch (e) {
        info += `❌ Ошибка тестирования: ${e.message}\n`;
      }
      
      return info;
    } catch (error) {
      console.error('Ошибка получения информации о порте:', error);
      return `Ошибка получения информации о порте: ${error.message}`;
    }
  }

  /**
   * Отображение информации о порте
   */
  async showPortInfo(port = null) {
    try {
      const targetPort = port || this.configManager.projectConfig.serialPort;
      
      if (!targetPort) {
        vscode.window.showErrorMessage('Порт не указан');
        return false;
      }
      
      const info = await this.getPortInfo(targetPort);
      
      if (!info) {
        vscode.window.showErrorMessage(`Не удалось получить информацию о порте ${targetPort}`);
        return false;
      }
      
      vscode.window.showInformationMessage(info, { modal: true });
      this.outputChannel.appendLine(`=== Информация о порте ${targetPort} ===\n${info}`);
      this.outputChannel.show();
      
      return true;
    } catch (error) {
      console.error('Ошибка отображения информации о порте:', error);
      vscode.window.showErrorMessage(`Ошибка отображения информации о порте: ${error.message}`);
      return false;
    }
  }

  /**
   * Мониторинг изменений в портах (экспериментальная функция)
   */
  startPortMonitoring(callback) {
    if (this.portMonitoringInterval) {
      clearInterval(this.portMonitoringInterval);
    }
    
    let previousPorts = [];
    
    this.portMonitoringInterval = setInterval(async () => {
      try {
        const currentPorts = await findAllSerialPorts();
        
        // Проверяем изменения
        const added = currentPorts.filter(p => !previousPorts.includes(p));
        const removed = previousPorts.filter(p => !currentPorts.includes(p));
        
        if (added.length > 0 || removed.length > 0) {
          if (callback) {
            callback({ added, removed, currentPorts });
          }
          
          // Логируем изменения
          if (added.length > 0) {
            this.outputChannel.appendLine(`🔌 Подключены порты: ${added.join(', ')}`);
          }
          
          if (removed.length > 0) {
            this.outputChannel.appendLine(`🔌 Отключены порты: ${removed.join(', ')}`);
          }
        }
        
        previousPorts = currentPorts;
      } catch (error) {
        console.error('Ошибка мониторинга портов:', error);
      }
    }, 3000); // Проверяем каждые 3 секунды
    
    this.outputChannel.appendLine('🚀 Мониторинг портов запущен');
    return this.portMonitoringInterval;
  }

  /**
   * Остановка мониторинга портов
   */
  stopPortMonitoring() {
    if (this.portMonitoringInterval) {
      clearInterval(this.portMonitoringInterval);
      this.portMonitoringInterval = null;
      this.outputChannel.appendLine('🛑 Мониторинг портов остановлен');
    }
  }

  /**
   * Получение статуса подключения
   */
  getConnectionStatus() {
    return {
      stLinkAvailable: fs.existsSync(this.configManager.projectConfig.programmerPath),
      serialPortConfigured: !!this.configManager.projectConfig.serialPort,
      connectedDevices: this.connectedDevices,
      platform: this.currentPlatform,
      workspacePath: this.workspacePath
    };
  }

  /**
   * Проверка наличия прошивки в МК
   */
  async checkFirmwareInMcu() {
    try {
      this.outputChannel.appendLine('=== Проверка прошивки в МК ===');
      
      const programmerPath = this.configManager.projectConfig.programmerPath;
      
      if (!fs.existsSync(programmerPath)) {
        vscode.window.showErrorMessage(`Программер не найден: ${programmerPath}`);
        return false;
      }
      
      const terminal = await runInTerminal(
        '', 
        'Проверка прошивки', 
        this.workspacePath, 
        this.configManager.projectConfig, 
        this.outputChannel
      );
      
      const commands = [
        'echo "Чтение содержимого Flash памяти..."',
        'echo ""',
        'echo "Чтение первых 256 байт памяти (начало вектора прерываний):"',
        `"${programmerPath}" -c port=SWD -r32 0x08000000 64 2>&1 | head -30`,
        'echo ""',
        'echo "Интерпретация:"',
        'echo "  - Первое значение: начальный указатель стека"',
        'echo "  - Второе значение: адрес reset handler"',
        'echo "  - Если все значения FFFFFFFF: память пуста"',
        'echo "  - Если есть не-FF значения: вероятно, есть прошивка"'
      ];
      
      commands.forEach(cmd => terminal.sendText(cmd));
      
      return true;
    } catch (error) {
      console.error('Ошибка проверки прошивки в МК:', error);
      vscode.window.showErrorMessage(`Ошибка проверки прошивки в МК: ${error.message}`);
      return false;
    }
  }
}

module.exports = ConnectionManager;