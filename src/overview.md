# 开篇总览

::: tip
源码基于 Vue 3.5.18 版本，[源码点击这](https://github.com/chenachen/vue-core-analysis)
:::


Vue 3 的源码结构清晰、模块边界明确，阅读起来相对友好。但如果没有一定的前置知识，直接上手会比较吃力。本系列会从整体到局部，拆解 Vue 3 的核心实现思路，帮助理清源码架构和设计逻辑。

## 📚 前置知识

在正式阅读源码之前，建议具备以下基础：

- 熟悉 Vue3 的基本使用与响应式机制
- 熟悉 JavaScript/TypeScript 语法（尤其是 Proxy、Reflect、class、泛型）
- 理解虚拟 DOM、编译器、渲染器等基础概念
- 掌握前端工程化常用工具（如 pnpm、Rollup）
- 熟悉 AST 的基本结构与遍历方式
- 有一定的数据结构和算法知识（位运算、链表、队列等等）

## 📂 packages 目录结构总览

Vue 3 源码采用 monorepo 管理方式，核心源码主要位于 `packages` 目录下：

```text
packages/
├─ compiler-core # 编译器核心逻辑
├─ compiler-dom # 针对 DOM 的编译逻辑
├─ compiler-sfc # 处理 .vue 单文件组件
├─ compiler-ssr # 服务端渲染编译器
├─ reactivity # 响应式系统核心
├─ runtime-core # 运行时核心逻辑
├─ runtime-dom # 针对 DOM 的运行时实现
├─ runtime-test # 测试专用的运行时
├─ server-renderer # SSR 渲染器
├─ shared # 工具函数和类型
└─ vue # 对外暴露的入口
```


> 说明：`shared` 模块在源码中被多个包复用，是阅读过程中频繁跳转的地方。

## 🧠 三大核心方向概览

### 1. reactivity — 响应式系统

- 核心文件位于 `packages/reactivity`
- 通过 Proxy 实现数据拦截和依赖收集
- 关键模块：
    - `reactive.ts`：响应式对象创建
    - `effect.ts`：副作用收集与触发
    - `computed.ts` / `ref.ts`：计算属性与 ref 实现
- 整体职责：为 runtime 层提供精确的依赖追踪和更新机制

### 2. runtime — 运行时

- 核心文件位于 `packages/runtime-core` 和 `packages/runtime-dom`
- 职责是「运行」编译后的 vnode tree
- 关键模块：
    - `renderer.ts`：渲染器核心逻辑
    - `component.ts`：组件实例化与更新
    - `scheduler.ts`：任务调度
    - `api*`：对外暴露的生命周期和 API
- `runtime-core` 关注平台无关逻辑，`runtime-dom` 实现 DOM 相关的渲染

### 3. compiler — 编译器

- 核心文件位于 `packages/compiler-*`
- 负责将模板（Template）转换成渲染函数（render）
- 三个阶段：
    1. parse → 将模板转成 AST
    2. transform → AST 转换、优化
    3. generate → 生成最终的 render 函数
- `compiler-core` 平台无关，`compiler-dom` 处理浏览器特定逻辑，`compiler-sfc` 处理单文件组件。

## 🧭 阅读源码的建议

- **先结构后细节**：先理解模块职责和调用关系，再深入到具体实现，避免陷入局部细节无法自拔。
- **多打断点调试**：仅看源码很难抓到执行顺序，建议用 IDE + 调试配合文档。
- **关注入口与出口**：搞清楚每个模块的输入与输出，有助于快速建立「功能地图」。
- **适当画图/做笔记**：流程图、调用链比文字更容易帮你梳理逻辑。
- **从简到繁阅读**：先看 `reactivity` 再看 `runtime`，最后再去啃编译器部分。
- **多参考官方文档和 RFC**：源码背后有设计思路，理解设计比代码更重要。
- **感觉这行代码莫名其妙？**：注释掉，然后跑一下测试用例，看看会发生什么。

## 📝 小结

Vue 3 的源码本身并不晦涩，难点在于模块多、逻辑分层清晰且耦合紧密。  
阅读的关键在于抓住主线脉络，再逐步下沉细节。  
**正确的阅读顺序 + 调试手段 + 全局视角**，比死磕一处源码更能帮助你真正理解 Vue 的设计哲学。

接下来，我们将从响应式系统开始，深入拆解 Vue 3 的内部机制。
