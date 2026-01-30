const vscode = require('vscode');
const path = require('path');
const { exec, spawn } = require('child_process');
const { platform } = require('os');
const fs = require('fs');

async function runInTerminal(command, name, workspacePath, projectConfig, outputChannel) {
  const terminal = vscode.window.createTerminal(`STM32: ${name}`);
  terminal.show();
  
  terminal.sendText('clear');
  
  // Set PATH to include GCC and Programmer tools
  const gccBinDir = path.dirname(projectConfig.gccPath);
  const programmerBinDir = path.dirname(projectConfig.programmerPath);
  
  const currentPlatform = platform();
  let pathSeparator = ':';
  
  if (currentPlatform === 'win32') {
    pathSeparator = ';';
    terminal.sendText(`chcp 65001`); // Set UTF-8 for Windows
  }
  
  terminal.sendText(`export PATH="${gccBinDir}${pathSeparator}${programmerBinDir}${pathSeparator}$PATH"`);
  
  if (workspacePath) {
    terminal.sendText(`cd "${workspacePath}"`);
  }
  
  terminal.sendText(command);
  return terminal;
}

async function execCommand(cmd, name, workspacePath, projectConfig, outputChannel) {
  return new Promise((resolve, reject) => {
    outputChannel.show();
    outputChannel.appendLine(`=== ${name} ===`);
    outputChannel.appendLine(`Command: ${cmd}`);
    outputChannel.appendLine('');
    
    const gccBinDir = path.dirname(projectConfig.gccPath);
    const programmerBinDir = path.dirname(projectConfig.programmerPath);
    const currentPlatform = platform();
    let pathSeparator = ':';
    
    if (currentPlatform === 'win32') {
      pathSeparator = ';';
    }
    
    const env = {
      ...process.env,
      PATH: `${gccBinDir}${pathSeparator}${programmerBinDir}${pathSeparator}${process.env.PATH}`,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    };
    
    const args = cmd.split(' ');
    const command = args.shift();
    
    const child = spawn(command, args, { 
      cwd: workspacePath, 
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdoutData = '';
    let stderrData = '';
    
    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutData += output;
      outputChannel.append(output);
    });
    
    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderrData += output;
      outputChannel.append(output);
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        outputChannel.appendLine(`\n✅ ${name} completed successfully.`);
        resolve({ stdout: stdoutData, stderr: stderrData });
      } else {
        outputChannel.appendLine(`\n❌ ${name} failed with exit code ${code}.`);
        const error = new Error(`${name} failed with exit code ${code}`);
        error.stdout = stdoutData;
        error.stderr = stderrData;
        error.code = code;
        reject(error);
      }
    });
    
    child.on('error', (err) => {
      outputChannel.appendLine(`\n🚨 Error executing ${name}: ${err.message}`);
      reject(err);
    });
  });
}

// Поиск портов с поддержкой конкретных имен
async function findSerialPorts(pattern = '*') {
  return new Promise((resolve) => {
    const currentPlatform = platform();
    
    // Если паттерн не содержит * и это конкретный порт
    if (pattern && !pattern.includes('*')) {
      fs.access(pattern, fs.constants.F_OK, (err) => {
        if (err) {
          resolve([]);
        } else {
          resolve([pattern]);
        }
      });
      return;
    }
    
    let cmd = '';
    
    switch (currentPlatform) {
      case 'darwin': // macOS
        cmd = `ls /dev/tty*usb* /dev/cu*usb* 2>/dev/null | sort -u || echo ""`;
        break;
      case 'linux':
        cmd = `ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | sort -u || echo ""`;
        break;
      case 'win32':
        cmd = `powershell -Command "Get-WMIObject Win32_SerialPort | ForEach-Object { $_.DeviceID }"`;
        break;
      default:
        resolve([]);
        return;
    }
    
    exec(cmd, (error, stdout) => {
      if (stdout && stdout.trim()) {
        let ports = stdout.trim().split('\n')
          .filter(p => p.trim() !== '')
          .filter(p => !p.includes('Bluetooth')); // Исключаем Bluetooth
        
        if (pattern && pattern !== '*') {
          const patternStr = pattern.replace(/\*/g, '.*');
          const regex = new RegExp(patternStr);
          ports = ports.filter(p => regex.test(p));
        }
        
        ports = [...new Set(ports)];
        console.log(`Found ${ports.length} port(s): ${ports.join(', ')}`);
        resolve(ports);
      } else {
        console.log('No serial ports found');
        resolve([]);
      }
    });
  });
}

// Проверка Python и pyserial
async function checkPython() {
  return new Promise((resolve) => {
    // Проверяем наличие Python
    exec('python3 --version 2>/dev/null || python --version 2>/dev/null', (pythonError) => {
      if (pythonError) {
        resolve({ 
          installed: false, 
          message: 'Python не установлен. Установите Python 3: https://www.python.org/downloads/' 
        });
        return;
      }
      
      // Проверяем наличие pyserial
      exec('python3 -c "import serial" 2>&1 || python -c "import serial" 2>&1', (serialError) => {
        if (serialError) {
          resolve({ 
            installed: false,
            message: 'Python установлен, но отсутствует pyserial. Установите: pip install pyserial' 
          });
        } else {
          resolve({ 
            installed: true, 
            message: 'Python и pyserial готовы к работе' 
          });
        }
      });
    });
  });
}

// Установка pyserial
async function installPyserial(workspacePath, outputChannel) {
  return new Promise((resolve, reject) => {
    outputChannel.appendLine('Устанавливаем pyserial...');
    
    exec('pip install pyserial', { cwd: workspacePath }, (error, stdout, stderr) => {
      if (stdout) outputChannel.append(stdout);
      if (stderr) outputChannel.append(stderr);
      
      if (error) {
        outputChannel.appendLine(`❌ Ошибка установки: ${error.message}`);
        reject(error);
      } else {
        outputChannel.appendLine('✅ pyserial установлен успешно');
        resolve();
      }
    });
  });
}

// Python монитор с очисткой буфера
async function startPythonMonitor(port, baudRate, name, workspacePath, projectConfig, outputChannel, options = {}) {
  const { clearBuffer = true, showInstructions = true } = options;
  
  const terminal = vscode.window.createTerminal(`STM32 Python Monitor: ${path.basename(port)}`);
  terminal.show();
  
  // Настраиваем окружение
  const gccBinDir = path.dirname(projectConfig.gccPath);
  const programmerBinDir = path.dirname(projectConfig.programmerPath);
  
  terminal.sendText(`export PATH="${gccBinDir}:${programmerBinDir}:$PATH"`);
  
  if (workspacePath) {
    terminal.sendText(`cd "${workspacePath}"`);
  }
  
  terminal.sendText('clear');
  
  if (showInstructions) {
    terminal.sendText(`echo "=========================================="`);
    terminal.sendText(`echo "STM32 Python Serial Monitor"`);
    terminal.sendText(`echo "Порт: ${port}"`);
    terminal.sendText(`echo "Скорость: ${baudRate} бод"`);
    terminal.sendText(`echo "Платформа: ${platform()}"`);
    terminal.sendText(`echo "=========================================="`);
    terminal.sendText(`echo ""`);
    terminal.sendText(`echo "Для выхода нажмите Ctrl+C"`);
    terminal.sendText(`echo "=========================================="`);
    terminal.sendText('');
  }
  
  // Создаем Python скрипт
  const pythonScript = `
import serial
import sys
import time

def main():
    port = '${port}'
    baud = ${baudRate}
    
    print(f"Подключаемся к {port} на скорости {baud} бод...")
    
    try:
        ser = serial.Serial(
            port=port,
            baudrate=baud,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.1,
            xonxoff=False,
            rtscts=False,
            dsrdtr=False
        )
    except Exception as e:
        print(f"❌ Ошибка подключения: {e}")
        print("Проверьте:")
        print("1. Порт указан правильно")
        print("2. Устройство подключено")
        print("3. Драйверы установлены")
        input("Нажмите Enter для выхода...")
        return
    
    print("✅ Подключено успешно!")
    print("Ожидание данных... (нажмите Ctrl+C для выхода)")
    print("-" * 50)
    
    # Очищаем буфер если нужно
    try:
        ser.reset_input_buffer()
        ser.reset_output_buffer()
        # Читаем возможные старые данные
        time.sleep(0.1)
        while ser.in_waiting:
            ser.read(ser.in_waiting)
            time.sleep(0.01)
    except:
        pass
    
    try:
        while True:
            if ser.in_waiting:
                try:
                    data = ser.read(ser.in_waiting)
                    # Пробуем декодить как UTF-8, игнорируем ошибки
                    text = data.decode('utf-8', errors='ignore')
                    sys.stdout.write(text)
                    sys.stdout.flush()
                except Exception as e:
                    # Если не UTF-8, выводим hex
                    hex_data = ' '.join(f'{b:02x}' for b in data)
                    sys.stdout.write(f"[HEX: {hex_data}]")
                    sys.stdout.flush()
            
            # Небольшая задержка для CPU
            time.sleep(0.01)
            
    except KeyboardInterrupt:
        print("\\nВыход...")
    except Exception as e:
        print(f"\\nОшибка: {e}")
    finally:
        ser.close()
        print("Порт закрыт")

if __name__ == "__main__":
    main()
`;
  
  // Записываем скрипт
  const scriptPath = path.join(workspacePath, 'stm32_monitor.py');
  fs.writeFileSync(scriptPath, pythonScript, 'utf8');
  
  // Запускаем скрипт
  if (platform() === 'win32') {
    terminal.sendText(`python "${scriptPath}"`);
  } else {
    terminal.sendText(`python3 "${scriptPath}"`);
  }
  
  // Удаляем скрипт через 10 секунд
  setTimeout(() => {
    try {
      fs.unlinkSync(scriptPath);
    } catch (e) {
      // Игнорируем ошибки удаления
    }
  }, 10000);
  
  return terminal;
}

// Простой Python монитор (без очистки буфера - чтобы видеть логи загрузки)
async function startBufferedPythonMonitor(port, baudRate, name, workspacePath, projectConfig, outputChannel) {
  const terminal = vscode.window.createTerminal(`STM32 Monitor (Buffered): ${path.basename(port)}`);
  terminal.show();
  
  const gccBinDir = path.dirname(projectConfig.gccPath);
  const programmerBinDir = path.dirname(projectConfig.programmerPath);
  
  terminal.sendText(`export PATH="${gccBinDir}:${programmerBinDir}:$PATH"`);
  
  if (workspacePath) {
    terminal.sendText(`cd "${workspacePath}"`);
  }
  
  terminal.sendText('clear');
  
  terminal.sendText(`echo "=========================================="`);
  terminal.sendText(`echo "STM32 Buffered Python Monitor"`);
  terminal.sendText(`echo "Порт: ${port}"`);
  terminal.sendText(`echo "Скорость: ${baudRate} бод"`);
  terminal.sendText(`echo "=========================================="`);
  terminal.sendText(`echo "Этот режим показывает логи загрузки МК"`);
  terminal.sendText(`echo "Для выхода нажмите Ctrl+C"`);
  terminal.sendText(`echo "=========================================="`);
  terminal.sendText('');
  
  // Скрипт для буферизованного монитора (сначала читаем старые данные)
  const pythonScript = `
import serial
import sys
import time

port = '${port}'
baud = ${baudRate}

print(f"Начинаем мониторинг {port}...")

try:
    ser = serial.Serial(
        port=port,
        baudrate=baud,
        bytesize=serial.EIGHTBITS,
        parity=serial.PARITY_NONE,
        stopbits=serial.STOPBITS_ONE,
        timeout=0.1
    )
except Exception as e:
    print(f"Ошибка: {e}")
    input("Нажмите Enter для выхода...")
    sys.exit(1)

print("Готово! Читаем данные...\\n")

# Сначала читаем все что уже есть в буфере (логи загрузки)
print("[Читаем существующие данные из буфера...]")
try:
    start_time = time.time()
    while time.time() - start_time < 1.0:  # Читаем 1 секунду
        if ser.in_waiting:
            data = ser.read(ser.in_waiting)
            text = data.decode('utf-8', errors='ignore')
            sys.stdout.write(text)
            sys.stdout.flush()
        time.sleep(0.01)
except:
    pass

print("\\n[Начинаем интерактивный мониторинг...]")
print("Нажмите Ctrl+C для выхода\\n")

try:
    while True:
        if ser.in_waiting:
            data = ser.read(ser.in_waiting)
            text = data.decode('utf-8', errors='ignore')
            sys.stdout.write(text)
            sys.stdout.flush()
        time.sleep(0.01)
except KeyboardInterrupt:
    print("\\nВыход...")
except Exception as e:
    print(f"\\nОшибка: {e}")
finally:
    ser.close()
`;
  
  const scriptPath = path.join(workspacePath, 'stm32_buffered.py');
  fs.writeFileSync(scriptPath, pythonScript, 'utf8');
  
  if (platform() === 'win32') {
    terminal.sendText(`python "${scriptPath}"`);
  } else {
    terminal.sendText(`python3 "${scriptPath}"`);
  }
  
  setTimeout(() => {
    try {
      fs.unlinkSync(scriptPath);
    } catch (e) {
      // Игнорируем
    }
  }, 10000);
  
  return terminal;
}

// Проверка доступности порта
async function testSerialPort(port, baudRate) {
  return new Promise((resolve) => {
    const currentPlatform = platform();
    
    if (currentPlatform === 'win32') {
      // Для Windows проверяем существование COM порта
      exec(`powershell -Command "[System.IO.Ports.SerialPort]::getportnames() -contains '${port.replace('\\\\\\\\\\\\.\\\\\\\\', '')}'"`, (error, stdout) => {
        resolve(stdout && stdout.trim() === 'True');
      });
    } else {
      // Для Linux/macOS
      exec(`stty -F ${port} ${baudRate} 2>&1`, (error) => {
        if (error) {
          // Пробуем через Python
          const pythonTest = `
import serial
try:
    ser = serial.Serial('${port}', ${baudRate}, timeout=0.1)
    ser.close()
    print("OK")
except:
    print("ERROR")
`;
          const testPath = path.join(__dirname, 'port_test.py');
          fs.writeFileSync(testPath, pythonTest, 'utf8');
          
          exec(`python3 "${testPath}" 2>/dev/null || python "${testPath}" 2>/dev/null`, (pyError, pyStdout) => {
            try { fs.unlinkSync(testPath); } catch {}
            resolve(pyStdout && pyStdout.includes('OK'));
          });
        } else {
          resolve(true);
        }
      });
    }
  });
}

// Поиск всех портов (для отладки)
async function findAllSerialPorts() {
  return new Promise((resolve) => {
    const currentPlatform = platform();
    let cmd = '';
    
    switch (currentPlatform) {
      case 'darwin':
        cmd = `ls /dev/tty* /dev/cu* 2>/dev/null | grep -i usb | sort -u || echo ""`;
        break;
      case 'linux':
        cmd = `ls /dev/ttyUSB* /dev/ttyACM* /dev/ttyAMA* /dev/ttyS* 2>/dev/null | sort -u`;
        break;
      case 'win32':
        cmd = `powershell -Command "Get-WMIObject Win32_SerialPort | ForEach-Object { $_.DeviceID }"`;
        break;
      default:
        resolve([]);
        return;
    }
    
    exec(cmd, (error, stdout) => {
      if (stdout && stdout.trim()) {
        const ports = stdout.trim().split('\n').filter(p => p.trim() !== '');
        resolve(ports);
      } else {
        resolve([]);
      }
    });
  });
}

module.exports = {
  runInTerminal,
  execCommand,
  findSerialPorts,
  findAllSerialPorts,
  testSerialPort,
  checkPython,
  installPyserial,
  startPythonMonitor,
  startBufferedPythonMonitor
};