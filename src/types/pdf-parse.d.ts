// pdf-parse 是可选运行时依赖（按需 import，未列入 package.json），无官方类型。
// 这里给个宽松环境声明，消除"找不到模块/类型"的编译错误；运行时 import 失败已被 try/catch 兜底。
declare module "pdf-parse";
