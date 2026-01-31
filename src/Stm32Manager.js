const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Импортируем менеджеры
const ConfigManager = require('./managers/ConfigManager');
const ProjectManager = require('./managers/ProjectManager');
const BuildManager = require('./managers/BuildManager');
const ConnectionManager = require('./managers/ConnectionManager');
const FlashManager = require('./managers/FlashManager');
const MonitorManager = require('./managers/MonitorManager');
const ToolsManager = require('./managers/ToolsManager');

class Stm32Manager {
  constructor(context) {
    this.context = context;
    this.workspacePath = null;
    this.currentPlatform = os.platform();
    this.outputChannel = vscode.window.createOutputChannel('STM32 Build');
    this.treeProvider = null;
    this.configWatchers = [];
    
    // Сначала устанавливаем workspacePath из текущего рабочего пространства
    this.setInitialWorkspace();
    
    // Затем инициализируем менеджеры с workspacePath
    this.configManager = new ConfigManager(this.workspacePath, this.currentPlatform);
    
    // Инициализируем остальные менеджеры
    this.projectManager = new ProjectManager(
      this.workspacePath, 
      this.configManager, 
      this.outputChannel
    );
    
    this.buildManager = new BuildManager(
      this.workspacePath,
      this.configManager,
      this.outputChannel
    );
    
    this.connectionManager = new ConnectionManager(
      this.configManager,
      this.outputChannel,
      this.workspacePath
    );
    
    this.flashManager = new FlashManager(
      this.workspacePath,
      this.configManager,
      this.outputChannel,
      this.buildManager,
      this.connectionManager
    );
    
    this.monitorManager = new MonitorManager(
      this.workspacePath,
      this.configManager,
      this.outputChannel,
      this.connectionManager
    );
    
    this.toolsManager = new ToolsManager(
      this.workspacePath,
      this.configManager,
      this.outputChannel
    );

    // Загружаем историю прошивок
    if (this.flashManager) {
      this.flashManager.loadHistoryFromFile();
    }
  }

  /**
   * Обрабатывает изменение конфига
   */
  async handleConfigChange(uri) {
    try {
      // Загружаем обновленный конфиг
      this.configManager.loadConfig();
      
      // Обновляем c_cpp_properties.json (если метод существует)
      if (typeof this.configManager.updateCppProperties === 'function') {
        await this.configManager.updateCppProperties();
      }
      
      // ВСЕГДА пересоздаем Makefile при изменении конфига
      console.log('⚡ Конфиг изменен - пересоздаем Makefile');
      const success = this.projectManager.generateMakefile();
      
      if (success) {
        console.log('✅ Makefile обновлен по конфигурации');
      }
      
      // Обновляем Tree View
      this.refreshView();
      
    } catch (error) {
      console.error('Ошибка обработки изменения конфига:', error);
      vscode.window.showErrorMessage(`Ошибка обработки конфига: ${error.message}`);
    }
  }

  /**
   * Устанавливаем начальный workspacePath из текущего рабочего пространства VS Code
   */
  setInitialWorkspace() {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      console.log('Initial workspace path set:', this.workspacePath);
    } else {
      this.workspacePath = null;
      console.log('No workspace folder open');
    }
  }

  /**
   * Обновляем рабочее пространство при изменениях
   */
  updateWorkspace() {
    const oldWorkspacePath = this.workspacePath;
    
    // Получаем текущий workspace
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
      this.workspacePath = null;
    }
    
    // Проверяем, изменился ли workspace
    if (oldWorkspacePath !== this.workspacePath) {
      console.log('Workspace updated:', oldWorkspacePath, '->', this.workspacePath);
      
      // Обновляем workspacePath во всех менеджерах
      this.updateManagersWorkspace();
      
      // Загружаем историю для нового workspace
      if (this.flashManager && this.workspacePath) {
        this.flashManager.loadHistoryFromFile();
      }
    }
    
    // Обновляем tree view
    this.refreshView();
    
    return this.workspacePath;
  }

  /**
   * Обновляет workspacePath во всех менеджерах
   */
  updateManagersWorkspace() {
    const managers = [
      this.configManager,
      this.connectionManager,
      this.projectManager,
      this.buildManager,
      this.flashManager,
      this.monitorManager,
      this.toolsManager
    ];
    
    managers.forEach(manager => {
      if (manager && typeof manager.workspacePath !== 'undefined') {
        manager.workspacePath = this.workspacePath;
      }
    });
    
    // Перезагружаем конфиг для нового workspace
    if (this.configManager) {
      this.configManager.loadConfig();
    }
  }

  /**
   * Освобождает все ресурсы
   */
  dispose() {
    this.closeSerialPort();
    
    if (this.outputChannel) {
      this.outputChannel.dispose();
    }
  }

  /**
   * Закрытие последовательного порта
   */
  closeSerialPort() {
    if (this.monitorManager) {
      this.monitorManager.stopMonitor();
    }
  }

  // Делегирование методов ProjectManager
  async setupProject() {
    return this.projectManager.setupProject();
  }

  async fixMakefile() {
    return this.projectManager.generateMakefile();
  }

  // Делегирование методов BuildManager
  async build() {
    return this.buildManager.build();
  }

  async quickBuild() {
    return this.buildManager.quickBuild();
  }

  async clean() {
    return this.buildManager.clean();
  }

  async fullClean() {
    return this.buildManager.fullClean();
  }

  async analyzeFirmwareSize() {
    return this.buildManager.analyzeFirmwareSize();
  }

  // Делегирование методов ConnectionManager
  async scanPorts() {
    return this.connectionManager.scanPorts();
  }

  async scanAllPorts() {
    return this.connectionManager.scanAllPorts();
  }

  async testPortConnection(port = null) {
    return this.connectionManager.testPortConnection(port);
  }

  async testAllPorts() {
    return this.connectionManager.testAllPorts();
  }

  async listDevices() {
    return this.connectionManager.listDevices();
  }

  async checkStLinkConnection() {
    return this.connectionManager.checkStLinkConnection();
  }

  async testProgrammer() {
    return this.connectionManager.testProgrammer();
  }

  async checkMcuConnection() {
    return this.connectionManager.checkMcuConnection();
  }

  async resetMcu() {
    return this.connectionManager.resetMcu();
  }

  async readMcuInfo() {
    return this.connectionManager.readMcuInfo();
  }

  async findAndSelectPort() {
    return this.connectionManager.findAndSelectPort();
  }

  async showPortInfo(port = null) {
    return this.connectionManager.showPortInfo(port);
  }

  async checkFirmwareInMcu() {
    return this.connectionManager.checkFirmwareInMcu();
  }

  startPortMonitoring(callback) {
    return this.connectionManager.startPortMonitoring(callback);
  }

  stopPortMonitoring() {
    return this.connectionManager.stopPortMonitoring();
  }

  getConnectionStatus() {
    return this.connectionManager.getConnectionStatus();
  }

  // Делегирование методов FlashManager
  async upload() {
    return this.flashManager.upload();
  }

  async uploadAndMonitor() {
    return this.flashManager.uploadAndMonitor();
  }

  async flashLatestBuild() {
    return this.flashManager.flashLatestBuild();
  }

  async verifyFlash() {
    return this.flashManager.verifyFlash();
  }

  async uploadWithoutReset() {
    return this.flashManager.uploadWithoutReset();
  }

  async eraseFlash() {
    return this.flashManager.eraseFlash();
  }

  async readProtection() {
    return this.flashManager.readProtection();
  }

  async showFlashHistory() {
    return this.flashManager.showFlashHistory();
  }

  async clearFlashHistory() {
    return this.flashManager.clearFlashHistory();
  }

  async showFirmwareInfo() {
    return this.flashManager.showFirmwareInfo();
  }

  async quickFlash() {
    return this.flashManager.quickFlash();
  }

  async resetMicrocontroller() {
    return this.flashManager.resetMicrocontroller();
  }

  async verifyFirmwareFile(firmwarePath) {
    return this.flashManager.verifyFirmwareFile(firmwarePath);
  }

  // Делегирование методов MonitorManager
  async smartMonitor() {
    return this.monitorManager.smartMonitor();
  }

  async monitor() {
    return this.monitorManager.monitor();
  }

  async stopMonitor() {
    return this.monitorManager.stopMonitor();
  }

  async resetMonitor() {
    return this.monitorManager.resetMonitor();
  }

  async checkPythonInstallation() {
    return this.monitorManager.checkPythonInstallation();
  }

  async changeBaudRate() {
    return this.monitorManager.changeBaudRate();
  }

  async sendCommandToMonitor() {
    return this.monitorManager.sendCommandToMonitor();
  }

  async clearMonitorScreen() {
    return this.monitorManager.clearMonitorScreen();
  }

  async saveMonitorLogs() {
    return this.monitorManager.saveMonitorLogs();
  }

  async configureMonitor() {
    return this.monitorManager.configureMonitor();
  }

  async testMonitorPort(port = null) {
    return this.monitorManager.testMonitorPort(port);
  }

  async showMonitorHistory() {
    return this.monitorManager.showMonitorHistory();
  }

  async startFilteredMonitor(filter) {
    return this.monitorManager.startFilteredMonitor(filter);
  }

  async exportMonitorSettings() {
    return this.monitorManager.exportMonitorSettings();
  }

  getMonitorStatus() {
    return this.monitorManager.getMonitorStatus();
  }

  // Делегирование методов ToolsManager
  async checkTools() {
    return this.toolsManager.checkTools();
  }

  async openTerminal() {
    return this.toolsManager.openTerminal();
  }

  async installMissingTools() {
    return this.toolsManager.installMissingTools();
  }

  async checkSystemRequirements() {
    return this.toolsManager.checkSystemRequirements();
  }

  async createSystemReport() {
    return this.toolsManager.createSystemReport();
  }

  async checkNetworkConnection() {
    return this.toolsManager.checkNetworkConnection();
  }

  async configureProxy() {
    return this.toolsManager.configureProxy();
  }

  async resetToolsConfiguration() {
    return this.toolsManager.resetToolsConfiguration();
  }

  async exportToolsConfiguration() {
    return this.toolsManager.exportToolsConfiguration();
  }

  async quickToolsCheck() {
    return this.toolsManager.quickToolsCheck();
  }

  // Общие методы
  async updatePaths() {
    return this.configManager.updateToolPaths();
  }

  // Метод для работы с конфигурацией
  async loadConfig() {
    if (this.configManager) {
      return this.configManager.loadConfig();
    }
    return null;
  }

  // Дополнительные методы
  async refreshView() {
    if (this.treeProvider) {
      this.treeProvider.refresh();
    }
  }
}

module.exports = Stm32Manager;