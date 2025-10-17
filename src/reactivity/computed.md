# Computed

经过上一章中对`dep`和`effect`介绍，我们已经了解了如何追踪响应式数据的变化。现在，我们将介绍另一个重要的概念——计算属性（computed
properties）。
这些属性基于其他响应式数据进行计算，并且会在其依赖的数据发生变化时自动更新。
本质上，也是一个`Subscriber`的实现。

## `computed`函数

```ts
export function computed<T>(
    getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
    debugOptions?: DebuggerOptions,
    isSSR = false,
) {
    let getter: ComputedGetter<T>
    let setter: ComputedSetter<T> | undefined

    // 判断传参是函数还是对象，如果是函数代表没有setter，该computed为只读
    if (isFunction(getterOrOptions)) {
        getter = getterOrOptions
    } else {
        getter = getterOrOptions.get
        setter = getterOrOptions.set
    }

    const cRef = new ComputedRefImpl(getter, setter, isSSR)

    if (__DEV__ && debugOptions && !isSSR) {
        cRef.onTrack = debugOptions.onTrack
        cRef.onTrigger = debugOptions.onTrigger
    }

    return cRef as any
}

```

computed函数用于创建计算属性。本身的实现还是较为简单的：

- `computed`函数接受一个getter函数或一个包含getter和setter的对象作为参数。如果是函数，则表示该计算属性是只读的。
- 它创建了一个`ComputedRefImpl`实例，该实例负责管理计算属性的值和依赖关系。
- 如果在开发环境中传入了调试选项，还会将调试回调函数绑定到计算属性实例上。
- 最后，返回计算属性实例。

## `ComputedRefImpl`类

还是先看看属性

```ts
export class ComputedRefImpl<T = any> implements Subscriber {
    /**
     * @internal
     */
    _value: any = undefined
    /**
     * 依赖于这个computed的依赖
     * @internal
     */
    readonly dep: Dep = new Dep(this)
    /**
     * 用于isRef判断
     * @internal
     */
    readonly __v_isRef = true
    // TODO isolatedDeclarations ReactiveFlags.IS_REF
    /**
     * @internal
     */
    readonly __v_isReadonly: boolean
    // TODO isolatedDeclarations ReactiveFlags.IS_READONLY
    // A computed is also a subscriber that tracks other deps
    /**
     * 用于关联这个computed和它所依赖的响应式数据之间的关系的link的链表头部
     * @internal
     */
    deps?: Link = undefined
    /**
     * 用于关联这个computed和它所依赖的响应式数据之间的关系的link的链表尾部
     * @internal
     */
    depsTail?: Link = undefined
    /**
     * 标记位
     * @internal
     */
    flags: EffectFlags = EffectFlags.DIRTY
    /**
     * 记录这个computed触发时间点的全局版本号，用于判断依赖是否变化，优化性能
     * @internal
     */
    globalVersion: number = globalVersion - 1
    /**
     * 服务端渲染标记
     * @internal
     */
    isSSR: boolean
    /**
     * 详见effect.ts endBatch方法，总之是个链表的指针，用于批处理时标记位的回滚操作
     * @internal
     */
    next?: Subscriber = undefined

    // for backwards compat
    effect: this = this
    // dev only
    onTrack?: (event: DebuggerEvent) => void
    // dev only
    onTrigger?: (event: DebuggerEvent) => void

    /**
     * Dev only
     * @internal
     */
    _warnRecursive?: boolean

    constructor(
        public fn: ComputedGetter<T>,
        private readonly setter: ComputedSetter<T> | undefined,
        isSSR: boolean,
    ) {
        this[ReactiveFlags.IS_READONLY] = !setter
        this.isSSR = isSSR
    }
}
```

- `_value`：存储计算属性的当前值。
- `dep`：一个`Dep`实例，用于追踪依赖于该计算属性的响应式数据，和`reactive`中响应式属性对应的`dep`类似,因为计算属性本身也是响应式的且只有一个
  `value`属性,所以直接挂载在实例上。
- `__v_isRef`：用于标识这是一个Ref类型的对象。当然了，这并不是真正的Ref，只是为了标记这是有`value`属性的响应式对象，主要用于
  `isRef`函数的判断。
- `__v_isReadonly`：用于标识这是一个只读的计算属性。
- `deps`和`depsTail`：用于管理该计算属性所依赖的响应式数据的链表。
- `flags`：标记计算属性的状态，如是否需要重新计算。
- `globalVersion`：用于优化性能，记录计算属性触发时间点的全局版本号。
- `isSSR`：标记是否在服务端渲染环境中。
- `next`：用于批处理时标记位的回滚操作的链表指针。
- `effect`：为了向后兼容，指向自身。
- `onTrack`和`onTrigger`：开发环境下的调试回调函数。
- `_warnRecursive`：用于防止递归调用的警告标记。
- 构造函数接受一个getter函数、一个可选的setter函数和一个服务端渲染标记，并初始化相应的属性。

### `value`属性的getter和setter

前面说到，计算属性实例和`ref`类似，有一个`value`属性，我们来看它的getter和setter是如何实现的。

```ts
export class ComputedRefImpl<T = any> implements Subscriber {
    get value(): T {
        // 依赖收集
        const link = __DEV__
            ? this.dep.track({
                target: this,
                type: TrackOpTypes.GET,
                key: 'value',
            })
            : this.dep.track()
        // 依赖更新
        refreshComputed(this)
        // sync version after evaluation
        // 更新链接的版本号
        if (link) {
            link.version = this.dep.version
        }
        return this._value
    }

    set value(newValue) {
        // 如果存在setter函数，则执行
        if (this.setter) {
            this.setter(newValue)
        } else if (__DEV__) {
            warn('Write operation failed: computed value is readonly')
        }
    }
}
```

setter比较简单，如果计算属性是只读的（没有提供setter函数），则在开发环境下发出警告；否则调用提供的setter函数就完事了。

getter则稍微复杂一些：

- 首先调用`this.dep.track()`进行依赖收集，确保当前的计算属性实例被正确地追踪。
- 然后调用`refreshComputed(this)`函数来检查是否需要重新计算计算属性的值。
- 接着，如果有链接存在，则更新链接的版本号以反映最新的依赖状态。
- 最后，返回计算属性的当前值`this._value`

### `notify`方法

计算属性实例除了`value`属性，让它像`ref`一样可以搜集引用本身的依赖外，由于本身也依赖于其他响应式数据更新自身的值，所以它还需要实现
`Subscriber`接口，以便能够追踪和响应其依赖的数据变化。

```ts
export class ComputedRefImpl<T = any> implements Subscriber {
    notify(): true | void {
        // 标记脏数据位
        this.flags |= EffectFlags.DIRTY
        // 如果还未被通知过，并且不是自己触发自己
        if (
            !(this.flags & EffectFlags.NOTIFIED) &&
            // avoid infinite self recursion
            // 避免无限循环
            activeSub !== this
        ) {
            // 执行batch函数进行批处理
            batch(this, true)
            return true
        } else if (__DEV__) {
            // TODO warn
        }
    }
}
```

`notify`方法在计算属性所依赖的响应式数据发生变化时被调用。它的主要功能是：

- 将计算属性的状态标记为脏（需要重新计算）。
- 检查计算属性是否已经被通知过，且当前没有处于自身触发的状态，以避免无限递归。
- 如果满足条件，调用`batch(this, true)`函数进行批处理，确保计算属性的更新是高效的。

至于该方法的调用时机，是在计算属性所依赖的响应式数据发生变化时，由这些数据对应的`dep`
实例调用的。[可以看下这里](./effectAndDep.md#depnotify)。

## `refreshComputed`函数

最后，我们来看一下`refreshComputed`函数，它负责检查计算属性是否需要重新计算其值。看看Vue是如何优化实现的。

```ts
export function refreshComputed(computed: ComputedRefImpl): undefined {
    if (
        // 正在依赖收集并且不是脏数据
        computed.flags & EffectFlags.TRACKING &&
        !(computed.flags & EffectFlags.DIRTY)
    ) {
        return
    }
    /**
     * 清空脏状态
     * ~EffectFlags.DIRTY是按位取反 EffectFlags.DIRTY 00010000，按位取反后变成11101111
     * &则是与运算，只有当两个位都为1时结果才为1
     * 所以 computed.flags &= ~EffectFlags.DIRTY是将computed.flags中的DIRTY位清除
     */
    computed.flags &= ~EffectFlags.DIRTY

    // Global version fast path when no reactive changes has happened since
    // last refresh.
    // 上次更新后没有再变化
    // 可以用于快速判断数据是否有过更新,如果相等则意味着自上次更新以后所有的依赖都没有更新过
    // 用于节省性能
    if (computed.globalVersion === globalVersion) {
        return
    }
    computed.globalVersion = globalVersion

    // In SSR there will be no render effect, so the computed has no subscriber
    // and therefore tracks no deps, thus we cannot rely on the dirty check.
    // Instead, computed always re-evaluate and relies on the globalVersion
    // fast path above for caching.
    // #12337 if computed has no deps (does not rely on any reactive data) and evaluated,
    // there is no need to re-evaluate.
    // 在 SSR 中不会有渲染effect，因此computed没有订阅者，因此没有track deps，因此我们不能依赖脏检查，应该使用执行更新
    // computed 始终重新计算并依赖于上面的 globalVersion 快速路径进行缓存。
    // #12337 如果计算没有 DEPS（不依赖于任何反应性数据）并已评估，则无需重新评估。
    if (
        // 非SSR环境下
        !computed.isSSR &&
        // 如果computed的flags中包含EVALUATED标志位
        // computed在首次执行后会添加该标志位,意味着已经执行过,用于优化一些非响应式数据依赖的computed
        computed.flags & EffectFlags.EVALUATED &&
        // 如果computed的deps不存在或者computed的_dirty属性不存在， 或者isDirty执行结果为false
        // _dirty目前我只发现在pinia的测试模块中使用 pinia/packages/testing/src/testing.ts
        ((!computed.deps && !(computed as any)._dirty) || !isDirty(computed))
    ) {
        return
    }
    // 正在运行中
    computed.flags |= EffectFlags.RUNNING

    const dep = computed.dep
    // 将当前活跃的订阅设置为本computed,和ReactiveEffect的run方法类似
    const prevSub = activeSub
    const prevShouldTrack = shouldTrack
    activeSub = computed
    shouldTrack = true

    try {
        // 将computed的一些状态重置
        prepareDeps(computed)
        // 执行fn得到新值
        const value = computed.fn(computed._value)
        // 判断计算值是否变化
        if (dep.version === 0 || hasChanged(value, computed._value)) {
            computed.flags |= EffectFlags.EVALUATED
            computed._value = value
            dep.version++
        }
    } catch (err) {
        dep.version++
        throw err
    } finally {
        // 回退状态
        activeSub = prevSub
        shouldTrack = prevShouldTrack
        cleanupDeps(computed)
        computed.flags &= ~EffectFlags.RUNNING
    }
}
```

`refreshComputed`函数的主要逻辑如下：

- 首先检查计算属性是否正在进行依赖收集且不是脏数据，如果是，则直接返回，无需重新计算。
- 清除计算属性的脏状态标记，因为即将进行重新计算。
- 检查全局版本号，如果自上次更新以来没有变化，则直接返回，避免不必要的计算。
- 在非SSR环境下，如果计算属性已经评估过且没有依赖变化，也直接返回。
- 往下的话，就是正式进行计算了，这和`ReactiveEffect`的[run方法](effectAndDep.md#run)是类似的：
    - 将计算属性的状态标记为正在运行。
    - 保存当前活跃的订阅者，并将活跃订阅者设置为当前计算属性，以便在计算过程中正确追踪依赖。
    - 调用`prepareDeps(computed)`函数，准备依赖关系。
    - 执行计算属性的getter函数，获取新的值。
    - 检查新值是否与旧值不同，如果不同，则更新计算属性的值并增加依赖版本号，将计算属性的状态标记为已评估和将新值赋值给
      `_value`。
    - 在`finally`块中，恢复之前的活跃订阅者状态，清理依赖关系，并将计算属性的运行状态标记为非运行中。

## 总结

1. 计算属性是基于其他响应式数据进行计算的特殊响应式数据。 通过实现`Subscriber`接口，计算属性能够追踪其依赖的数据变化，并在必要时重新计算其值。
2. 通过优化的依赖追踪和版本控制机制（`globalVersion`， dirty检查），计算属性能够在性能和响应性之间取得良好的平衡。