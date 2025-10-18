# Watch

这章我们来说说 Vue 3 反应式系统中的 `watch` API。`watch` 允许我们观察一个或多个响应式数据源的变化，并在它们发生变化时执行回调函数。
需要注意的是，`v.3.5` 版本中 `reactivity`模块导出的`watch`并不是我们在 Vue 组件中使用的完整版 `watch`，而是一个更基础的版本。
完整版的 `watch` 是在 `runtime-core` 模块中的`apiWatch`基于这个基础版本进行扩展和封装的。
[原因在这](https://github.com/vuejs/core/pull/9927)，有兴趣的可以看下。

## `watch` 函数

打开`packages/reactivity/src/watch.ts`

这个函数可有够长的，但是别急我们一步一步看。
先放完整源码，想直接看逐步分析[点击这里](#start)

```ts
export function watch(
    source: WatchSource | WatchSource[] | WatchEffect | object,
    cb?: WatchCallback | null,
    options: WatchOptions = EMPTY_OBJ,
): WatchHandle {
    const {immediate, deep, once, scheduler, augmentJob, call} = options

    const warnInvalidSource = (s: unknown) => {
        ;(options.onWarn || warn)(
            `Invalid watch source: `,
            s,
            `A watch source can only be a getter/effect function, a ref, ` +
            `a reactive object, or an array of these types.`,
        )
    }

    const reactiveGetter = (source: object) => {
        // 如果是deep，则直接返回源数据
        // traverse will happen in wrapped getter below
        if (deep) return source
        // for `deep: false | 0` or shallow reactive, only traverse root-level properties
        // 只监听最浅一层对象数据
        if (isShallow(source) || deep === false || deep === 0)
            return traverse(source, 1)
        // for `deep: undefined` on a reactive object, deeply traverse all properties
        // 深度递归所有属性
        // 这与vue2侦听对象时不太一致，如果传入的是响应式对象，默认就深度监听
        // const obj = reactive({ a: 1, b: { c: 2 } })
        // watch(obj, cb) // 默认深度监听
        return traverse(source)
    }

    // 定义一个响应式副作用对象，用于管理依赖的响应式数据和副作用逻辑
    let effect: ReactiveEffect
    // 定义一个函数，用于获取响应式数据的值或执行副作用逻辑
    let getter: () => any
    // 定义一个可选的清理函数，用于在副作用重新执行前清理资源
    let cleanup: (() => void) | undefined
    // 定义一个绑定的清理函数，用于注册清理逻辑到当前的响应式副作用
    let boundCleanup: typeof onWatcherCleanup
    // 定义一个布尔值，指示是否强制触发副作用逻辑
    let forceTrigger = false
    // 定义一个布尔值，指示是否有多个数据源
    let isMultiSource = false

    // 根据不同的 source 类型，设置 getter 函数
    if (isRef(source)) {
        // 如果 source 是一个 ref，则设置 getter 为获取 ref 的值，并根据是否为浅层 ref 设置 forceTrigger
        getter = () => source.value
        forceTrigger = isShallow(source)
    } else if (isReactive(source)) {
        // 如果 source 是一个响应式对象，则设置 getter 为获取响应式对象的值，并强制触发
        getter = () => reactiveGetter(source)
        forceTrigger = true
    } else if (isArray(source)) {
        // 如果 source 是一个数组，则处理多个数据源
        isMultiSource = true
        // 如果数组中有响应式对象或浅层 ref，则设置 forceTrigger 为 true
        forceTrigger = source.some(s => isReactive(s) || isShallow(s))
        // 设置 getter 为遍历数组，获取每个数据源的值
        getter = () =>
            // 监听多个来源时，遍历每个来源，返回一个包含所有来源值的数组
            source.map(s => {
                if (isRef(s)) {
                    return s.value
                } else if (isReactive(s)) {
                    return reactiveGetter(s)
                } else if (isFunction(s)) {
                    return call ? call(s, WatchErrorCodes.WATCH_GETTER) : s()
                } else {
                    __DEV__ && warnInvalidSource(s)
                }
            })
    } else if (isFunction(source)) {
        /**
         * source是函数时，获取函数返回值
         * 例子：
         * watch(() => someReactiveObject.someProperty, cb)
         */
        if (cb) {
            // getter with cb
            getter = call
                ? () => call(source, WatchErrorCodes.WATCH_GETTER)
                : (source as () => any)
        } else {
            // no cb -> simple effect
            // 没有cb则对应这种场景
            // test('effect', () => {
            //   let dummy: any
            //   const source = ref(0)
            //   watch(() => {
            //     dummy = source.value
            //   })
            //   expect(dummy).toBe(0)
            //   source.value++
            //   expect(dummy).toBe(1)
            // })
            getter = () => {
                // 如果清理函数存在，则先暂停追踪，执行清理函数，最后重置追踪状态
                if (cleanup) {
                    pauseTracking()
                    try {
                        cleanup()
                    } finally {
                        resetTracking()
                    }
                }
                // 设置当前effect为activeWatcher
                const currentEffect = activeWatcher
                activeWatcher = effect
                try {
                    // 如果call存在则调用，否则直接执行source函数
                    return call
                        ? call(source, WatchErrorCodes.WATCH_CALLBACK, [boundCleanup])
                        : source(boundCleanup)
                } finally {
                    // 回退状态
                    activeWatcher = currentEffect
                }
            }
        }
    } else {
        // 如果 source 类型无效，则设置 getter 为 NOOP，并在开发环境下发出警告
        getter = NOOP
        __DEV__ && warnInvalidSource(source)
    }

    if (cb && deep) {
        const baseGetter = getter
        const depth = deep === true ? Infinity : deep
        // 深度遍历时，递归执行getter
        getter = () => traverse(baseGetter(), depth)
    }

    // 获取当前作用域
    const scope = getCurrentScope()

    /**
     * 停止监听函数
     * const unwatch = watch(source, cb)
     * unwatch就是执行这个函数
     */
    const watchHandle: WatchHandle = () => {
        // 暂停本effect执行和监听
        effect.stop()
        // 如果当前作用域活跃中，将本effect在作用域中移除
        if (scope && scope.active) {
            remove(scope.effects, effect)
        }
    }

    // 如果选项中带once参数，则将callback函数重新赋值，执行一次后移除响应的effect
    if (once && cb) {
        const _cb = cb
        cb = (...args) => {
            _cb(...args)
            watchHandle()
        }
    }

    // 记录旧值
    let oldValue: any = isMultiSource
        ? new Array((source as []).length).fill(INITIAL_WATCHER_VALUE)
        : INITIAL_WATCHER_VALUE

    const job = (immediateFirstRun?: boolean) => {
        // 当前effect函数未激活，或者effect函数未脏且不是首次执行，则直接返回
        if (
            !(effect.flags & EffectFlags.ACTIVE) ||
            (!effect.dirty && !immediateFirstRun)
        ) {
            return
        }
        if (cb) {
            // watch(source, cb)， 执行effect函数得到新值
            const newValue = effect.run()
            if (
                deep ||
                forceTrigger ||
                (isMultiSource
                    ? (newValue as any[]).some((v, i) => hasChanged(v, oldValue[i]))
                    : hasChanged(newValue, oldValue))
            ) {
                // 深度监听或强制触发或值发生变更，执行以下逻辑
                // cleanup before running cb again
                // 执行回调函数前先执行清理函数
                if (cleanup) {
                    cleanup()
                }
                // 设置当前effect为activeWatcher
                const currentWatcher = activeWatcher
                activeWatcher = effect
                try {
                    // 参数处理，用于执行callback函数
                    const args = [
                        newValue,
                        // pass undefined as the old value when it's changed for the first time
                        // 如果是第一次变更则传undefined，否则传oldValue
                        oldValue === INITIAL_WATCHER_VALUE
                            ? undefined
                            : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE
                                ? []
                                : oldValue,
                        boundCleanup,
                    ]
                    // 缓存当前值为oldValue
                    oldValue = newValue
                    // 执行callback函数
                    call
                        ? call(cb!, WatchErrorCodes.WATCH_CALLBACK, args)
                        : // @ts-expect-error
                        cb!(...args)
                } finally {
                    // 执行完毕回退状态
                    activeWatcher = currentWatcher
                }
            }
        } else {
            // watchEffect
            effect.run()
        }
    }

    // 目前仅发现apiWatch.ts中使用了augmentJob
    if (augmentJob) {
        augmentJob(job)
    }

    // 创建一个effect函数，监听getter中涉及的响应式数据变化时触发执行
    effect = new ReactiveEffect(getter)

    // 设置调度器，在响应式数据变化时执行job函数
    effect.scheduler = scheduler
        ? () => scheduler(job, false)
        : (job as EffectScheduler)

    /**
     * 绑定清理函数
     * watch(source, (newValue, oldValue, onCleanup <- boundCleanup就是这个 ) => {})
     */
    boundCleanup = fn => onWatcherCleanup(fn, false, effect)

    // 设置effect的onStop钩子函数，在effect停止时执行
    cleanup = effect.onStop = () => {
        const cleanups = cleanupMap.get(effect)
        if (cleanups) {
            if (call) {
                call(cleanups, WatchErrorCodes.WATCH_CLEANUP)
            } else {
                for (const cleanup of cleanups) cleanup()
            }
            cleanupMap.delete(effect)
        }
    }

    if (__DEV__) {
        effect.onTrack = options.onTrack
        effect.onTrigger = options.onTrigger
    }

    // initial run
    // 初始化执行
    if (cb) {
        if (immediate) {
            job(true)
        } else {
            oldValue = effect.run()
        }
    } else if (scheduler) {
        scheduler(job.bind(null, true), true)
    } else {
        effect.run()
    }

    // 绑定pause、resume和stop方法到watchHandle
    watchHandle.pause = effect.pause.bind(effect)
    watchHandle.resume = effect.resume.bind(effect)
    watchHandle.stop = watchHandle

    return watchHandle
}
```

### 入参 {#start}

这个函数接收三个参数：

- `source`：要观察的响应式数据源，可以是一个响应式对象、一个 ref、一个函数，或者它们的数组。
- `cb`：当数据源变化时调用的回调函数，接收新值和旧值作为参数。
- `options`：一个可选的配置对象，可以包含以下属性：
    - `immediate`：是否在初始时立即执行回调函数。
    - `deep`：是否进行深度监听。
    - `once`：是否只监听一次变化。
    - `scheduler`：一个调度函数，用于控制回调函数的执行时机。
    - `augmentJob`：用于扩展作业函数的钩子。
    - `call`：用于调用函数的钩子。
    - `onWarn`：用于处理警告的钩子。

然后往下看

### 入参解析处理

```ts
const {immediate, deep, once, scheduler, augmentJob, call} = options

const warnInvalidSource = (s: unknown) => {
    ;(options.onWarn || warn)(
        `Invalid watch source: `,
        s,
        `A watch source can only be a getter/effect function, a ref, ` +
        `a reactive object, or an array of these types.`,
    )
}
```

这里没啥可讲的，就是解构选项对象，并定义一个警告函数，用于在 source 类型无效时发出警告。

### `reactiveGetter`

```ts
const reactiveGetter = (source: object) => {
    // 如果是deep，则直接返回源数据
    // traverse will happen in wrapped getter below
    if (deep) return source
    // for `deep: false | 0` or shallow reactive, only traverse root-level properties
    // 只监听最浅一层对象数据
    if (isShallow(source) || deep === false || deep === 0)
        return traverse(source, 1)
    // for `deep: undefined` on a reactive object, deeply traverse all properties
    // 深度递归所有属性
    // 这与vue2侦听对象时不太一致，如果传入的是响应式对象，默认就深度监听
    // const obj = reactive({ a: 1, b: { c: 2 } })
    // watch(obj, cb) // 默认深度监听
    return traverse(source)
}
```

这里定义了一个辅助函数 `reactiveGetter`，用于根据 `deep` 选项来获取响应式对象的值。

- 如果 `deep` 为真（包含true和大于0的数字），则直接返回源数据，方便下面根据传入的deep处理监听深度，和undefined不一样；
- 如果是浅层响应式对象或 `deep` 为假或零，则只遍历根级属性；
- 当`deep`是undefined时，递归遍历所有属性（也就是监听所有属性），不受`deep`影响。

### 变量定义

接下来是一些变量的定义：

```ts
// 定义一个响应式副作用对象，用于管理依赖的响应式数据和副作用逻辑
let effect: ReactiveEffect
// 定义一个函数，用于获取响应式数据的值或执行副作用逻辑
let getter: () => any
// 定义一个可选的清理函数，用于在副作用重新执行前清理资源
let cleanup: (() => void) | undefined
// 定义一个绑定的清理函数，用于注册清理逻辑到当前的响应式副作用
let boundCleanup: typeof onWatcherCleanup
// 定义一个布尔值，指示是否强制触发副作用逻辑
let forceTrigger = false
// 定义一个布尔值，指示是否有多个数据源
let isMultiSource = false
```

这些变量将在后续逻辑中使用，用于管理响应式副作用、获取数据值、处理清理逻辑等。

### 处理 `source` 类型

然后是根据不同的 `source` 类型，设置 `getter` 函数的逻辑：

```ts
// 根据不同的 source 类型，设置 getter 函数
if (isRef(source)) {
    // 如果 source 是一个 ref，则设置 getter 为获取 ref 的值，并根据是否为浅层 ref 设置 forceTrigger
    getter = () => source.value
    forceTrigger = isShallow(source)
} else if (isReactive(source)) {
    // 如果 source 是一个响应式对象，则设置 getter 为获取响应式对象的值，并强制触发
    getter = () => reactiveGetter(source)
    forceTrigger = true
} else if (isArray(source)) {
    // 如果 source 是一个数组，则处理多个数据源
    isMultiSource = true
    // 如果数组中有响应式对象或浅层 ref，则设置 forceTrigger 为 true
    forceTrigger = source.some(s => isReactive(s) || isShallow(s))
    // 设置 getter 为遍历数组，获取每个数据源的值
    getter = () =>
        // 监听多个来源时，遍历每个来源，返回一个包含所有来源值的数组
        source.map(s => {
            if (isRef(s)) {
                return s.value
            } else if (isReactive(s)) {
                return reactiveGetter(s)
            } else if (isFunction(s)) {
                return call ? call(s, WatchErrorCodes.WATCH_GETTER) : s()
            } else {
                __DEV__ && warnInvalidSource(s)
            }
        })
} else if (isFunction(source)) {
    /**
     * source是函数时，获取函数返回值
     * 例子：
     * watch(() => someReactiveObject.someProperty, cb)
     */
    if (cb) {
        // getter with cb
        getter = call
            ? () => call(source, WatchErrorCodes.WATCH_GETTER)
            : (source as () => any)
    } else {
        // no cb -> simple effect
        // 没有cb则对应这种场景
        // test('effect', () => {
        //   let dummy: any
        //   const source = ref(0)
        //   watch(() => {
        //     dummy = source.value
        //   })
        //   expect(dummy).toBe(0)
        //   source.value++
        //   expect(dummy).toBe(1)
        // })
        getter = () => {
            // 如果清理函数存在，则先暂停追踪，执行清理函数，最后重置追踪状态
            if (cleanup) {
                pauseTracking()
                try {
                    cleanup()
                } finally {
                    resetTracking()
                }
            }
            // 设置当前effect为activeWatcher
            const currentEffect = activeWatcher
            activeWatcher = effect
            try {
                // 如果call存在则调用，否则直接执行source函数
                return call
                    ? call(source, WatchErrorCodes.WATCH_CALLBACK, [boundCleanup])
                    : source(boundCleanup)
            } finally {
                // 回退状态
                activeWatcher = currentEffect
            }
        }
    }
} else {
    // 如果 source 类型无效，则设置 getter 为 NOOP，并在开发环境下发出警告
    getter = NOOP
    __DEV__ && warnInvalidSource(source)
}
```

这里根据 `source` 的不同类型，设置了相应的 `getter` 函数：

- 如果 `source` 是一个 ref，则 `getter` 返回 ref 的值，并根据是否为浅层 ref 设置 `forceTrigger`。
- 如果 `source` 是一个响应式对象，则 `getter` 使用 `reactiveGetter` 获取值，并强制触发。
- 如果 `source` 是一个数组，则处理多个数据源，`getter` 遍历数组，获取每个数据源的值，并根据是否包含响应式对象或浅层 ref 设置
  `forceTrigger`。
- 如果 `source` 是一个函数，则根据是否提供了回调函数 `cb` 来设置 `getter`。
    - 如果提供了 `cb`，则 `getter` 调用 `source` 函数获取值。
    - 如果没有提供 `cb`，则 `getter` 作为一个简单的副作用函数，执行 `source` 函数，并处理清理逻辑。
- 如果 `source` 类型无效，则 `getter` 设置为 `NOOP`，并在开发环境下发出警告。

### 处理 `deep` 选项

上面处理完`source`的不同场景，接下来是处理 `deep` 选项的逻辑：

```ts
if (cb && deep) {
    const baseGetter = getter
    const depth = deep === true ? Infinity : deep
    // 深度遍历时，递归执行getter
    getter = () => traverse(baseGetter(), depth)
}
```

如果提供了回调函数 `cb` 且 `deep` 为真，则重新定义 `getter`，使其在获取值时进行深度遍历。

### 定义取消监听函数

```ts
// 获取当前作用域
const scope = getCurrentScope()

/**
 * 停止监听函数
 * const unwatch = watch(source, cb)
 * unwatch就是执行这个函数
 */
const watchHandle: WatchHandle = () => {
    // 暂停本effect执行和监听
    effect.stop()
    // 如果当前作用域活跃中，将本effect在作用域中移除
    if (scope && scope.active) {
        remove(scope.effects, effect)
    }
}
```

接下来定义了一个 `watchHandle` 函数，用于停止监听。当调用这个函数时，会停止 `effect` 的执行和监听，并将其从当前作用域中移除（如果作用域仍然活跃）。

### 处理 `once` 选项

```ts
// 如果选项中带once参数，则将callback函数重新赋值，执行一次后移除响应的effect
if (once && cb) {
    const _cb = cb
    cb = (...args) => {
        _cb(...args)
        watchHandle()
    }
}
```

如果设置了 `once` 且提供了回调函数 `cb`，则重新定义 `cb`，使其在执行一次后调用 `watchHandle` 停止监听。

### 定义 `job` 函数，作为响应式副作用的调度器

```ts
// 记录旧值
let oldValue: any = isMultiSource
    ? new Array((source as []).length).fill(INITIAL_WATCHER_VALUE)
    : INITIAL_WATCHER_VALUE

const job = (immediateFirstRun?: boolean) => {
    // 当前effect函数未激活，或者effect函数未脏且不是首次执行，则直接返回
    if (
        !(effect.flags & EffectFlags.ACTIVE) ||
        (!effect.dirty && !immediateFirstRun)
    ) {
        return
    }
    if (cb) {
        // watch(source, cb)， 执行effect函数得到新值
        const newValue = effect.run()
        if (
            deep ||
            forceTrigger ||
            (isMultiSource
                ? (newValue as any[]).some((v, i) => hasChanged(v, oldValue[i]))
                : hasChanged(newValue, oldValue))
        ) {
            // 深度监听或强制触发或值发生变更，执行以下逻辑
            // cleanup before running cb again
            // 执行回调函数前先执行清理函数
            if (cleanup) {
                cleanup()
            }
            // 设置当前effect为activeWatcher
            const currentWatcher = activeWatcher
            activeWatcher = effect
            try {
                // 参数处理，用于执行callback函数
                const args = [
                    newValue,
                    // pass undefined as the old value when it's changed for the first time
                    // 如果是第一次变更则传undefined，否则传oldValue
                    oldValue === INITIAL_WATCHER_VALUE
                        ? undefined
                        : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE
                            ? []
                            : oldValue,
                    boundCleanup,
                ]
                // 缓存当前值为oldValue
                oldValue = newValue
                // 执行callback函数
                call
                    ? call(cb!, WatchErrorCodes.WATCH_CALLBACK, args)
                    : // @ts-expect-error
                    cb!(...args)
            } finally {
                // 执行完毕回退状态
                activeWatcher = currentWatcher
            }
        }
    } else {
        // watchEffect
        effect.run()
    }
}

// 目前仅发现apiWatch.ts中使用了augmentJob
if (augmentJob) {
    augmentJob(job)
}
```

这里定义了一个 `job` 函数，作为响应式副作用的调度器。当响应式数据变化时，会调用这个函数来执行相应的逻辑。

- 首先检查 `effect` 是否激活且脏，若不满足条件则直接返回。
- 如果提供了回调函数 `cb`，则执行 `effect.run()` 获取新值，并根据 `deep`、`forceTrigger` 和新旧值的变化情况决定是否执行回调逻辑。
    - 在执行回调前，先调用清理函数（如果存在）。
    - 设置当前 `effect` 为 `activeWatcher`，准备执行回调函数。
    - 构造参数数组，包含新值、旧值和绑定的清理函数。
    - 缓存新值为旧值，并调用回调函数。
    - 最后回退 `activeWatcher` 状态。
- 如果没有提供回调函数，则直接执行 `effect.run()`。
- 如果提供了 `augmentJob`，则调用它来扩展 `job` 函数。

### 创建 `ReactiveEffect` 实例

```ts
// 创建一个effect函数，监听getter中涉及的响应式数据变化时触发执行
effect = new ReactiveEffect(getter)

// 设置调度器，在响应式数据变化时执行job函数
effect.scheduler = scheduler
    ? () => scheduler(job, false)
    : (job as EffectScheduler)
```

这里创建了一个 `ReactiveEffect` 实例 `effect`，并将之前定义的 `getter` 传入。
然后根据是否提供了自定义的 `scheduler`，设置 `effect` 的调度器为调用 `job` 函数。

### 绑定清理函数和debugger参数

```ts
/**
 * 绑定清理函数
 * watch(source, (newValue, oldValue, onCleanup <- boundCleanup就是这个 ) => {})
 */
boundCleanup = fn => onWatcherCleanup(fn, false, effect)

// 设置effect的onStop钩子函数，在effect停止时执行
cleanup = effect.onStop = () => {
    const cleanups = cleanupMap.get(effect)
    if (cleanups) {
        if (call) {
            call(cleanups, WatchErrorCodes.WATCH_CLEANUP)
        } else {
            for (const cleanup of cleanups) cleanup()
        }
        cleanupMap.delete(effect)
    }
}

if (__DEV__) {
    effect.onTrack = options.onTrack
    effect.onTrigger = options.onTrigger
}
```

### 初始化执行

```ts
if (cb) {
    if (immediate) {
        job(true)
    } else {
        oldValue = effect.run()
    }
} else if (scheduler) {
    scheduler(job.bind(null, true), true)
} else {
    effect.run()
}
```

这里处理了初始化执行的逻辑：

- 如果提供了回调函数 `cb`，则根据 `immediate` 选项决定是否立即执行 `job` 函数，或者先运行 `effect` 获取初始值。
- 如果没有提供 `cb` 但提供了 `scheduler`，则通过调度器执行 `job`。
- 如果既没有 `cb` 也没有 `scheduler`，则直接运行 `effect`。

### 绑定控制方法并返回

```ts
// 绑定pause、resume和stop方法到watchHandle
watchHandle.pause = effect.pause.bind(effect)
watchHandle.resume = effect.resume.bind(effect)
watchHandle.stop = watchHandle
return watchHandle
```

最后，绑定了 `pause`、`resume` 和 `stop` 方法到 `watchHandle`，并返回 `watchHandle` 作为停止监听的函数。

## 总结

总的来说，这里的代码看起来很繁杂，但是核心其实就几个点：

1. 根据不同的 `source` 类型，设置合适的 `getter` 函数。
2. 创建一个 `ReactiveEffect` 实例，监听 `getter` 中涉及的响应式数据变化。
3. 定义一个 `job` 函数，作为响应式副作用的调度器，在数据变化时执行相应的逻辑。
4. 处理各种选项，如 `deep`、`immediate`、`once` 等，以满足不同的使用场景。
5. 提供`pause`、`resume` 和 `stop` 方法，方便用户控制监听的生命周期。

