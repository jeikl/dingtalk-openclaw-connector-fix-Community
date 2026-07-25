/**
 * 日志工具模块
 * 根据配置里的 debug 控制日志输出（无需环境变量）
 */

/** 任一账号/连接开启过 debug 后为 true；默认静默 */
let pluginDebugEnabled = false;

/**
 * 设置插件全局 debug（由配置 `debug: true` 驱动）
 * 仅在 true 时打开；避免多账号中未开 debug 的账号把开关关掉。
 */
export function setDingtalkDebug(enabled: boolean): void {
  if (enabled) pluginDebugEnabled = true;
}

/** 是否输出图片/引用/队列等详细诊断日志 */
export function isDingtalkDebug(): boolean {
  return pluginDebugEnabled;
}

/**
 * 创建日志记录器
 * @param debug - 是否启用 debug 模式
 * @param prefix - 日志前缀
 * @returns 日志记录器对象
 */
export function createLogger(debug: boolean = false, prefix: string = '') {
  if (debug) setDingtalkDebug(true);

  const logger = {
    /**
     * 打印 info 级别日志
     * 仅在 debug 模式下输出
     */
    info(...args: any[]) {
      if (debug) {
        if (prefix) {
          console.log(`[${prefix}]`, ...args);
        } else {
          console.log(...args);
        }
      }
    },

    /**
     * 打印 warn 级别日志
     * 始终输出
     */
    warn(...args: any[]) {
      if (prefix) {
        console.warn(`[${prefix}]`, ...args);
      } else {
        console.warn(...args);
      }
    },

    /**
     * 打印 error 级别日志
     * 始终输出
     */
    error(...args: any[]) {
      if (prefix) {
        console.error(`[${prefix}]`, ...args);
      } else {
        console.error(...args);
      }
    },

    /**
     * 打印 debug 级别日志
     * 仅在 debug 模式下输出
     */
    debug(...args: any[]) {
      if (debug) {
        if (prefix) {
          console.log(`[DEBUG][${prefix}]`, ...args);
        } else {
          console.log('[DEBUG]', ...args);
        }
      }
    },
  };

  return logger;
}

/**
 * 从配置中创建日志记录器
 * @param config - 包含 debug 配置的对象（可选）
 * @param prefix - 日志前缀
 * @returns 日志记录器对象
 */
export function createLoggerFromConfig(
  config: { debug?: boolean } | undefined | null,
  prefix: string = '',
) {
  return createLogger(!!config?.debug, prefix);
}
