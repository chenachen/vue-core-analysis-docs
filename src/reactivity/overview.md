#  Reactivity 总览

`reactivity` 是 Vue 3 的核心之一，它支撑了整个组件更新机制，是运行时高效更新视图的基础。  
这一层可以理解为 Vue 的「灵魂」，它通过精确的依赖收集与触发机制，实现了极高的性能与灵活性。  
与 Vue 2 相比，这部分实现发生了本质变化，从 `Object.defineProperty` 切换到 `Proxy`，不仅能力更强、维护更简洁，也让 Vue 拥有了更好的可扩展性。

## 📦 目录结构总览

`reactivity` 包的结构非常干净，所有能力都围绕响应式的创建、依赖收集、调度与释放展开：

```text
packages/reactivity/
├─ src/
│ ├─ arrayInstrumentations.ts # 处理数组方法的拦截逻辑
│ ├─ baseHandlers.ts # 处理普通对象的拦截逻辑
│ ├─ collectionHandlers.ts # 处理 Set/Map/WeakMap 等集合类型的拦截逻辑
│ ├─ computed.ts # computed 实现
│ ├─ constants.ts # 常量定义
│ ├─ dep.ts # 依赖集合的数据结构
│ ├─ effect.ts # 副作用收集与调度的核心
│ ├─ effectScope.ts # effectScope 实现
│ ├─ reactive.ts # reactive/ref/shallow 等 API 的入口
│ ├─ ref.ts # ref 与 shallowRef
│ ├─ warning.ts # 调试辅助
│ ├─ watch.ts # watch 实现
│ └─ index.ts # 对外暴露的入口
```

## 🧠 核心设计思路

Vue 3 的响应式系统基于「依赖收集 → 变更触发 → 视图更新」这条主线展开。  
核心的角色主要有四个：

### 1. Reactive 对象的创建

- 通过 `reactive()` / `ref()` / `shallowReactive()` 等 API 创建响应式对象。
- 内部通过 Proxy 拦截 `get`、`set`、`delete` 操作，实现对依赖的追踪与变更的响应。
- 对集合类型（Map、Set）有专门的 handler，区别于普通对象。

### 2. Effect 与依赖收集

- `effect(fn)` 用于注册一个副作用函数。
- 当副作用在执行过程中访问响应式对象时，会通过 `track` 记录依赖。
- 每个依赖都对应一个 `dep` 链表，用来存储相关的 effect。

### 3. 变更触发与调度

- 当响应式对象被修改时，会触发 `trigger`。
- `trigger` 找到对应的依赖集合，执行副作用函数。

### 4. 派生与特殊响应式

- `computed` 基于 `effect` 实现懒执行与缓存。
- `ref` 是响应式系统的轻量封装，支持基础数据类型。
- `readonly` 与 `shallow` 是对 reactive 的变体，控制响应式深度和可变性。

## 📝 小结

- `reactivity` 是 Vue 3 响应式系统的核心，主要由 **Proxy 拦截 + effect 副作用机制 + 调度器** 构成。
- 整体逻辑非常清晰：**创建响应式 → 收集依赖 → 触发更新**。
- 理解这部分后，再看 `runtime` 层的组件更新机制会更顺畅。

接下来，我们会从一个简单的Demo开始，拆解响应式系统的核心。


