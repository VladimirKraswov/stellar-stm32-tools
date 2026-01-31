const fs = require('fs');
const path = require('path');

class MakefileGenerator {
  constructor(workspacePath, configManager) {
    this.workspacePath = workspacePath;
    this.configManager = configManager;
  }

  /**
   * Просто создает/перезаписывает Makefile с актуальной конфигурацией
   */
  generate() {
    if (!this.workspacePath) {
      console.error('❌ Не указана рабочая папка');
      return false;
    }

    // Получаем актуальную конфигурацию
    const projectConfig = this.configManager.projectConfig;
    const mcuParams = this.configManager.getMCUParams(projectConfig.mcu);
    
    const startupFile = projectConfig.startupFile || mcuParams.startupFile;
    const ldscript = projectConfig.ldscript || 'STM32F407XX_FLASH.ld';

    // Генерируем содержимое
    const makefileContent = this.generateContent(
      projectConfig.projectName,
      startupFile,
      ldscript,
      mcuParams,
      projectConfig
    );

    // Записываем файл
    const makefilePath = path.join(this.workspacePath, 'Makefile');
    
    try {
      fs.writeFileSync(makefilePath, makefileContent, 'utf8');
      console.log('✅ Makefile создан/обновлен');
      return true;
    } catch (error) {
      console.error('❌ Ошибка записи Makefile:', error.message);
      return false;
    }
  }

  /**
   * Генерирует содержимое Makefile
   */
  generateContent(projectName, startupFile, ldscript, mcuParams, projectConfig) {
    // Обработка исключаемых файлов
    const excludeRule = projectConfig.excludeFiles?.length > 0
      ? `\n# Исключаемые файлы\nC_SOURCES := $(filter-out ${projectConfig.excludeFiles.map(f => `%${f}`).join(' ')}, $(C_SOURCES))`
      : '';

    return `################################################################################
# Автоматически сгенерировано STM32 Tools
# Проект: ${projectName}
# MCU: ${projectConfig.mcu || 'STM32F407VG'}
# Дата: ${new Date().toLocaleString()}
################################################################################

TARGET = ${projectName}
DEBUG = 1
OPT = -Og
BUILD_DIR = build

# Исходные файлы
C_SOURCES = \\
${projectConfig.sourceDirs.map(dir => `\t$(wildcard ${dir}/*.c)`).join(' \\\n')}${excludeRule}

# Стартап файл
ASM_SOURCES = \\
\t${startupFile}.s

# Инструменты
PREFIX = arm-none-eabi-
CC = \$(PREFIX)gcc
AS = \$(PREFIX)gcc -x assembler-with-cpp
CP = \$(PREFIX)objcopy
SZ = \$(PREFIX)size

# Параметры MCU
CPU = ${mcuParams.cpu}
FPU = ${mcuParams.fpu}
FLOAT-ABI = ${mcuParams.floatAbi}
MCU = \$(CPU) -mthumb \$(FPU) \$(FLOAT-ABI)

# Определения препроцессора
C_DEFS = \\
\t-DUSE_HAL_DRIVER \\
\t-D${mcuParams.define}

# Пути include
C_INCLUDES = \\
${projectConfig.includeDirs.map(dir => `\t-I${dir}`).join(' \\\n')}

# Флаги компиляции
ASFLAGS = \$(MCU) \$(AS_DEFS) \$(AS_INCLUDES) \$(OPT) -Wall -fdata-sections -ffunction-sections
CFLAGS = \$(MCU) \$(C_DEFS) \$(C_INCLUDES) \$(OPT) -Wall -fdata-sections -ffunction-sections

ifeq (\$(DEBUG), 1)
CFLAGS += -g -gdwarf-2
endif

CFLAGS += -MMD -MP -MF"\$(@:%.o=%.d)"

# Флаги линковки
LDSCRIPT = ${ldscript}
LIBS = -lc -lm -lnosys 
LDFLAGS = \$(MCU) -specs=nano.specs -T\$(LDSCRIPT) \$(LIBS) -Wl,-Map=\$(BUILD_DIR)/\$(TARGET).map,--cref -Wl,--gc-sections

# Основная цель
all: \$(BUILD_DIR)/\$(TARGET).elf \$(BUILD_DIR)/\$(TARGET).hex \$(BUILD_DIR)/\$(TARGET).bin

# Правила сборки
OBJECTS = \$(addprefix \$(BUILD_DIR)/,\$(notdir \$(C_SOURCES:.c=.o)))
vpath %.c \$(sort \$(dir \$(C_SOURCES)))
OBJECTS += \$(addprefix \$(BUILD_DIR)/,\$(notdir \$(ASM_SOURCES:.s=.o)))
vpath %.s \$(sort \$(dir \$(ASM_SOURCES)))

\$(BUILD_DIR)/%.o: %.c Makefile | \$(BUILD_DIR) 
\t\$(CC) -c \$(CFLAGS) -Wa,-a,-ad,-alms=\$(BUILD_DIR)/\$(notdir \$(<:.c=.lst)) \$< -o \$@

\$(BUILD_DIR)/%.o: %.s Makefile | \$(BUILD_DIR)
\t\$(AS) -c \$(CFLAGS) \$< -o \$@

\$(BUILD_DIR)/\$(TARGET).elf: \$(OBJECTS) Makefile
\t\$(CC) \$(OBJECTS) \$(LDFLAGS) -o \$@
\t\$(SZ) \$@

\$(BUILD_DIR)/%.hex: \$(BUILD_DIR)/%.elf | \$(BUILD_DIR)
\t\$(CP) -O ihex \$< \$@

\$(BUILD_DIR)/%.bin: \$(BUILD_DIR)/%.elf | \$(BUILD_DIR)
\t\$(CP) -O binary -S \$< \$@

\$(BUILD_DIR):
\tmkdir -p \$@

# Очистка
clean:
\t-rm -fR \$(BUILD_DIR)

# Прошивка
flash: \$(BUILD_DIR)/\$(TARGET).bin
\tSTM32_Programmer_CLI -c port=SWD -w "\$<" -v -rst

# Зависимости
-include \$(wildcard \$(BUILD_DIR)/*.d)`;
  }
}

module.exports = MakefileGenerator;