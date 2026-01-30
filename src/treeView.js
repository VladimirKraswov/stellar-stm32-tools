const vscode = require('vscode');

/**
 * Константы для структурирования категорий и команд
 */
const TREE_STRUCTURE = {
    CATEGORIES: [
        { id: 'general', label: 'General', icon: 'tools', context: 'category' },
        { id: 'project', label: 'Project', icon: 'folder', context: 'category' },
        { id: 'debug', label: 'Debug', icon: 'debug', context: 'category' },
        { id: 'device', label: 'Device', icon: 'device-desktop', context: 'category' },
        { id: 'settings', label: 'Settings', icon: 'settings-gear', context: 'category' }
    ],
    
    COMMANDS: {
        general: [
            { id: 'stm32.setupProject', label: 'Setup Project', description: '', icon: 'wrench' },
            { id: 'stm32.checkTools', label: 'Check Tools', description: '', icon: 'checklist' },
            { id: 'stm32.openTerminal', label: 'Open Terminal', description: '', icon: 'terminal' },
            { id: 'stm32.refreshView', label: 'Refresh', description: '', icon: 'refresh' }
        ],
        project: [
            { id: 'stm32.build', label: 'Build', description: '', icon: 'gear' },
            { id: 'stm32.clean', label: 'Clean', description: '', icon: 'trashcan' },
            { id: 'stm32.fullClean', label: 'Full Clean', description: '', icon: 'clear-all' },
            { id: 'stm32.upload', label: 'Upload', description: '', icon: 'cloud-upload' },
            { id: 'stm32.uploadAndMonitor', label: 'Upload & Monitor', description: '', icon: 'play' },
            { id: 'stm32.monitor', label: 'Monitor', description: '', icon: 'terminal' }
        ],
        debug: [
            { id: 'stm32.debug', label: 'Start Debugging', description: '', icon: 'debug-start' }
        ],
        device: [
            { id: 'stm32.listDevices', label: 'List Devices', description: '', icon: 'list-tree' },
            { id: 'stm32.testProgrammer', label: 'Test Programmer', description: '', icon: 'test-view' }
        ],
        settings: [
            { id: 'stm32.projectConfig', label: 'Project Config', description: '', icon: 'settings' },
            { id: 'stm32.updatePaths', label: 'Update Paths', description: '', icon: 'folder-opened' }
        ]
    }
};

/**
 * Категория дерева навигации (совместимый вариант)
 */
class Stm32CategoryItem extends vscode.TreeItem {
    constructor(label, icon) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        
        // Поддержка нового и старого формата конструктора
        const categoryData = TREE_STRUCTURE.CATEGORIES.find(cat => cat.label === label);
        
        this.iconPath = new vscode.ThemeIcon(categoryData ? categoryData.icon : icon);
        this.contextValue = 'category';
        this.tooltip = `${label} commands`;
    }
}

/**
 * Элемент команды с улучшенным оформлением (совместимый вариант)
 */
class Stm32CommandItem extends vscode.TreeItem {
    constructor(label, commandId, description = '', icon = 'gear') {
        super(label, vscode.TreeItemCollapsibleState.None);
        
        this.command = { 
            command: commandId, 
            title: label, 
            arguments: [] 
        };
        
        this.iconPath = new vscode.ThemeIcon(icon);
        this.tooltip = description;
        this.description = description;
        this.contextValue = 'command';
        this.isImportant = false;
        
        // Визуальное выделение важных действий
        this._applyStyling(label, icon);
    }
    
    /**
     * Применение стилей к команде
     */
    _applyStyling(label, icon) {
        // Выделение цветом важных команд
        const importantCommands = ['Build', 'Upload', 'Debug', 'Start Debugging'];
        if (importantCommands.some(cmd => label.includes(cmd))) {
            this.isImportant = true;
            this.iconPath = new vscode.ThemeIcon(
                icon,
                new vscode.ThemeColor('debugIcon.startForeground')
            );
        }
    }
}

/**
 * Провайдер данных дерева с улучшенной структурой
 * Сохраняет совместимость с исходным кодом
 */
class Stm32TreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._eventEmitter = this._onDidChangeTreeData;
    }

    /**
     * Получение элемента дерева
     */
    getTreeItem(element) {
        return element;
    }

    /**
     * Получение дочерних элементов
     * Сохраняет совместимость со старым кодом
     */
    getChildren(element = null) {
        if (!element) {
            return this._getRootCategories();
        }
        
        // Поддержка обоих форматов: по label или по контексту
        const categoryId = this._getCategoryId(element);
        const commands = this._getCategoryCommands(categoryId);
        
        // Применяем декорации ко всем командам
        return commands.map(cmd => this._decorateCommandItem(cmd, categoryId));
    }

    /**
     * Получение корневых категорий (совместимый формат)
     */
    _getRootCategories() {
        return TREE_STRUCTURE.CATEGORIES.map(category => 
            new Stm32CategoryItem(category.label, category.icon)
        );
    }

    /**
     * Получение ID категории из элемента
     */
    _getCategoryId(element) {
        // Сопоставление label с ID категории
        const labelMap = {
            'General': 'general',
            'Project': 'project',
            'Debug': 'debug',
            'Device': 'device',
            'Settings': 'settings'
        };
        
        return labelMap[element.label] || element.label?.toLowerCase();
    }

    /**
     * Получение команд для категории (совместимый формат)
     */
    _getCategoryCommands(categoryId) {
        const commands = TREE_STRUCTURE.COMMANDS[categoryId] || [];
        return commands.map(command => 
            new Stm32CommandItem(
                command.label,
                command.id,
                command.description,
                command.icon
            )
        );
    }

    /**
     * Декорация элемента команды (если требуется дополнительная обработка)
     */
    _decorateCommandItem(item, categoryId) {
        // Убедимся, что у всех команд одинаковые отступы
        if (!item.collapsibleState) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        
        // Добавляем отступ для лучшей читаемости
        let indentLevel = 1;
        if (categoryId === 'project') {
            indentLevel = item.isImportant ? 2 : 1; // Дополнительный отступ для важных команд в 'Project'
        }
        Stm32TreeDecorator.addIndent(item, indentLevel);
        
        return item;
    }

    /**
     * Обновление дерева
     */
    refresh() {
        this._eventEmitter.fire();
    }

    /**
     * Получение команды по ID
     */
    getCommandById(commandId) {
        for (const category of Object.values(TREE_STRUCTURE.COMMANDS)) {
            const command = category.find(cmd => cmd.id === commandId);
            if (command) return command;
        }
        return null;
    }

    /**
     * Получение всех команд
     */
    getAllCommands() {
        return Object.values(TREE_STRUCTURE.COMMANDS).flat();
    }
}

/**
 * Дополнительный декоратор для расширенной функциональности
 */
class Stm32TreeDecorator {
    static addStatus(item, status) {
        const statusConfig = {
            'running': { 
                icon: 'sync~spin',
                color: new vscode.ThemeColor('charts.yellow')
            },
            'success': {
                icon: 'pass',
                color: new vscode.ThemeColor('testing.iconPassed')
            },
            'error': {
                icon: 'error',
                color: new vscode.ThemeColor('testing.iconFailed')
            }
        };
        
        if (status && statusConfig[status]) {
            const config = statusConfig[status];
            item.iconPath = new vscode.ThemeIcon(config.icon, config.color);
        }
        return item;
    }
    
    /**
     * Добавление отступа к элементу
     */
    static addIndent(item, level = 1) {
        // Добавляем пробелы для визуального отступа
        const indent = '\u00A0'.repeat(level);  // Уменьшили до level, чтобы отступ был меньше
        if (!item.label.startsWith(indent)) {
            item.label = `${indent}${item.label}`;
        }
        return item;
    }
}

// Экспорт с сохранением исходных имен для совместимости
module.exports = {
    Stm32TreeDataProvider,
    Stm32CategoryItem,
    Stm32CommandItem,
    // Дополнительные утилиты
    TreeDecorator: Stm32TreeDecorator,
    TREE_STRUCTURE
};