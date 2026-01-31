// src/activation.js
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { Stm32TreeDataProvider } = require('./treeView');
const Stm32Manager = require('./Stm32Manager');

let stm32Manager;
let treeDataProvider;
let treeView;

function activate(context) {
  console.log('STM32 Tools activated');

  try {
    // Инициализация менеджера
    stm32Manager = new Stm32Manager();
    
    // Инициализация TreeDataProvider
    treeDataProvider = new Stm32TreeDataProvider();
    
    // Привязываем treeProvider к менеджеру
    if (stm32Manager) {
      stm32Manager.treeProvider = treeDataProvider;
    }

    // Регистрация TreeDataProvider с правильным ID
    const disposable = vscode.window.registerTreeDataProvider(
      'stellar-stm32-platform.view',
      treeDataProvider
    );
    
    context.subscriptions.push(disposable);

    // Регистрация команд
    const register = (id, handler) => 
      vscode.commands.registerCommand(id, async (...args) => {
        try {
          // Убедимся, что менеджер инициализирован
          if (!stm32Manager) {
            vscode.window.showErrorMessage('STM32 Manager не инициализирован');
            return;
          }
          await handler(...args);
        } catch (err) {
          console.error(`Error in command ${id}:`, err);
          vscode.window.showErrorMessage(`${id} failed: ${err.message}`);
        }
      });

    // Регистрация основных команд
    const commands = [
      // General
      register('stm32.setupProject', () => stm32Manager.setupProject()),
      register('stm32.checkTools', () => stm32Manager.checkTools()),
      register('stm32.openTerminal', () => stm32Manager.openTerminal()),
      register('stm32.refreshView', () => stm32Manager.refreshView()),
      
      // Build
      register('stm32.build', () => stm32Manager.build()),
      register('stm32.clean', () => stm32Manager.clean()),
      register('stm32.fullClean', () => stm32Manager.fullClean()),
      
      // Flash
      register('stm32.upload', () => stm32Manager.upload()),
      register('stm32.uploadAndMonitor', () => stm32Manager.uploadAndMonitor()),
      
      // Monitor
      register('stm32.monitor', () => stm32Manager.monitor()),
      
      // Device
      register('stm32.listDevices', () => stm32Manager.listDevices()),
      register('stm32.testProgrammer', () => stm32Manager.testProgrammer()),
      
      // Project
      register('stm32.updatePaths', () => stm32Manager.updatePaths()),
      
      // Settings
      register('stm32.projectConfig', () => {
        if (!stm32Manager.workspacePath) {
          vscode.window.showWarningMessage('Open a workspace folder first');
          return;
        }
        
        const configPath = path.join(stm32Manager.workspacePath, '.stm32-config.json');
        if (fs.existsSync(configPath)) {
          vscode.workspace.openTextDocument(configPath).then(doc => {
            vscode.window.showTextDocument(doc);
          });
        } else {
          vscode.window.showInformationMessage(
            'Project config not found. Create it?',
            'Yes',
            'No'
          ).then(choice => {
            if (choice === 'Yes') {
              stm32Manager.setupProject();
            }
          });
        }
      }),

      register('stm32.forceRegenerateMakefile', async () => {
        if (!stm32Manager.workspacePath) {
          vscode.window.showErrorMessage('Откройте папку проекта сначала');
          return;
        }
        
        const choice = await vscode.window.showWarningMessage(
          'Вы уверены, что хотите полностью перезаписать Makefile?',
          { modal: true },
          'Да, перезаписать',
          'Отмена'
        );
        
        if (choice === 'Да, перезаписать') {
          const success = await stm32Manager.projectManager.makefileGenerator.generateMakefile();
          if (success) {
            vscode.window.showInformationMessage('Makefile успешно перезаписан');
          }
        }
      }),
      
      // Debug
      register('stm32.debug', () => {
        vscode.commands.executeCommand('workbench.action.debug.start');
      })
    ];

    // Добавляем все команды в подписки
    commands.forEach(cmd => context.subscriptions.push(cmd));

    // Обработчик сохранения конфигурационного файла
    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.endsWith('.stm32-config.json')) {
        console.log('Config file saved, reloading config...');
        
        if (stm32Manager && stm32Manager.configManager) {
          stm32Manager.configManager.loadConfig();
        }
        
        vscode.window.showInformationMessage('STM32 configuration reloaded');
      }
    });

    context.subscriptions.push(saveListener);

    // Обновляем tree view после инициализации
    setTimeout(() => {
      if (treeDataProvider) {
        treeDataProvider.refresh();
      }
    }, 1000);

    console.log('STM32 Tools fully activated');
    
  } catch (error) {
    console.error('Error during activation:', error);
    vscode.window.showErrorMessage(`Failed to activate STM32 Tools: ${error.message}`);
  }
}

function deactivate() {
  console.log('STM32 Tools deactivated');
  
  if (stm32Manager) {
    try {
      stm32Manager.closeSerialPort();
    } catch (error) {
      console.error('Error during deactivation:', error);
    }
  }
  
  return Promise.resolve();
}

module.exports = {
  activate,
  deactivate
};