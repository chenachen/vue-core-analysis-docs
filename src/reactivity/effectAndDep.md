# Effect & Dep

还记得我们在[Demo](./demo.md)或者[Reactive](./reactive.md)源码中提到的`track`和`trigger`
吗？它们是实现响应式系统的核心机制。今天，我们将深入探讨它们的实现原理以及它们在Vue 3中的具体应用。

## `track`函数 {#track}

```ts
export function track(target: object, type: TrackOpTypes, key: unknown): void {
    // targetMap是个WeakMap，以原始对象为key，Map为值，而这个map则以target的key为key，存储Dep对象
    if (shouldTrack && activeSub) {
        let depsMap = targetMap.get(target)
        // 初次追踪则创建Map
        if (!depsMap) {
            targetMap.set(target, (depsMap = new Map()))
        }
        let dep = depsMap.get(key)
        if (!dep) {
            // 创建dep对象
            depsMap.set(key, (dep = new Dep()))
            dep.map = depsMap
            dep.key = key
        }
        // 创建完毕之后调用dep对象的track方法
        if (__DEV__) {
            dep.track({
                target,
                type,
                key,
            })
        } else {
            dep.track()
        }
    }
}
```

可以看到，`track`函数主要做了以下几件事：

- 检查是否应该进行依赖收集（`shouldTrack`）以及是否有活跃的订阅者（`activeSub`）。
- 从`targetMap`中获取对应的`depsMap`，如果不存在则创建一个新的`Map`。
- 从`depsMap`中获取对应的`dep`，如果不存在则创建一个新的`Dep`对象。
- 最后调用`dep`的`track`方法进行依赖收集。

这已经和我们在[Demo](./demo.md)中实现的`track`函数非常相似了。

主要的区别在于，我们这里使用了一个`Dep`类来管理依赖，而不是直接使用`Set`。这样做的好处是可以更好地封装依赖管理的逻辑。

## `Dep`类的实现 {#dep}

### `Dep`类的属性和方法

```ts
export class Dep {
    version = 0

    activeLink?: Link = undefined

    subs?: Link = undefined

    subsHead?: Link

    map?: KeyToDepMap = undefined
    key?: unknown = undefined

    sc: number = 0

    readonly __v_skip = true

    constructor(public computed?: ComputedRefImpl | undefined) {
        if (__DEV__) {
            this.subsHead = undefined
        }
    }

    track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
    }

    trigger(debugInfo?: DebuggerEventExtraInfo): void {
    }

    notify(debugInfo?: DebuggerEventExtraInfo): void {
    }
}
```

先来看看`Dep`类的属性：

- `version`：依赖的版本控制，主要用于缓存结果和清理无用依赖。
- `activeLink`：指向当前活跃的订阅者相关的Link链接。
- `subs`和`subsHead`：分别表示订阅者的双向链表的尾节点和头节点。
- `map`和`key`：用于对象属性依赖的清理。
- `sc`：订阅者计数器，用于判断是否需要清理依赖。
- `computed`：如果这个`Dep`是用于计算属性的，则会存储对应的`ComputedRefImpl`实例。
- `__v_skip`：用于标识这个对象不需要被Vue的响应式系统处理。
- `track`、`trigger`和`notify`方法：分别用于依赖收集、触发依赖和通知订阅者。

::: tip
注意，副作用函数主要指`effect`函数，而订阅者主要指实现了`Subscriber`接口的类的实例对象，例如`ReactiveEffect`和
`ComputedRefImpl`。
如果你能理解这两个概念，那么理解`Dep`类的实现就会容易很多。
更具体点说：

1. 副作用函数的概念是与纯函数这个概念相对的，纯函数是指在相同输入下总是返回相同输出，并且没有任何副作用的函数，而副作用函数则是指那些可能会修改外部状态或者依赖外部状态的函数。
   在Vue中，`effect`函数就是一个典型的副作用函数，因为它会依赖外部的响应式数据，并在响应式数据变化时重新执行，从而更新视图。
2. 而订阅者的概念则是与发布者这个概念相对的，发布者是指那些能够发布消息或者事件的对象，而订阅者则是指那些能够订阅这些消息或者事件并作出响应的对象。
   在Vue中，`ReactiveEffect`和`ComputedRefImpl`就是典型的订阅者，因为它们会订阅响应式数据的变化，并在数据变化时重新计算或者执行。
   :::

### `Dep`类的`track`方法 {#deptrack}

接着上面`track`函数的调用，我们来看下`Dep`类的`track`方法：

```ts
class Dep {
    track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
        /**
         * 没有activeSub，也就是没有活跃的订阅者
         * 或者不应该追踪（pauseTracking被执行）
         * 或者活跃的订阅者就是当前dep的computed，避免computed内部读取自己的值时造成死循环
         */
        if (!activeSub || !shouldTrack || activeSub === this.computed) {
            return
        }

        let link = this.activeLink
        // 判断当前link是否未定义或者订阅者不是当前活跃的订阅
        if (link === undefined || link.sub !== activeSub) {
            link = this.activeLink = new Link(activeSub, this)

            // add the link to the activeEffect as a dep (as tail)
            // 将当前link连接到当前活跃的订阅者的deps的双向链表尾部
            // 主要用于执行完依赖后清除已执行的依赖
            if (!activeSub.deps) {
                activeSub.deps = activeSub.depsTail = link
            } else {
                // 链表操作，将当前link放到已有的activeSub的尾部
                link.prevDep = activeSub.depsTail
                activeSub.depsTail!.nextDep = link
                activeSub.depsTail = link
            }

            // 添加订阅者
            addSub(link)
        } else if (link.version === -1) {
            // reused from last run - already a sub, just sync version
            link.version = this.version

            // If this dep has a next, it means it's not at the tail - move it to the
            // tail. This ensures the effect's dep list is in the order they are
            // accessed during evaluation.
            // 如果这个 dep 有 next，则表示它不在尾部
            // 将其移动到尾部
            // 这可确保effect的 dep 列表按照评估期间访问它们的顺序排列。
            if (link.nextDep) {
                // link的上下游链接在一起，相当于把当前link从链表中删除
                const next = link.nextDep
                next.prevDep = link.prevDep
                if (link.prevDep) {
                    link.prevDep.nextDep = next
                }

                // 把当前link放到尾节点
                link.prevDep = activeSub.depsTail
                link.nextDep = undefined
                activeSub.depsTail!.nextDep = link
                activeSub.depsTail = link

                // this was the head - point to the new head
                // 如果link是首节点，则重新指向下一个节点
                if (activeSub.deps === link) {
                    activeSub.deps = next
                }
            }
        }

        // 如果是开发环境，并且当前活跃的订阅者有onTrack钩子函数，则调用该函数
        if (__DEV__ && activeSub.onTrack) {
            activeSub.onTrack(
                extend(
                    {
                        effect: activeSub,
                    },
                    debugInfo,
                ),
            )
        }

        return link
    }
}
```

我们逐步解析

```ts
if (!activeSub || !shouldTrack || activeSub === this.computed) {
    return
}
```

这里是检查：

- 否有活跃的订阅者（`activeSub`），例子是使用`reactive`等定义的响应式数据，并不是通过`effect`
  函数去执行的,或者订阅者处于不活跃状态，这样是无法有效的捕捉到依赖的，
  `activeSub`就会是undefined
- 是否应该进行依赖收集（`shouldTrack`），这个变量主要用于控制依赖收集的开关，例如在某些情况下我们可能不希望进行依赖收集，那么就可以通过
  `pauseTracking`方法暂停依赖收集，之后再通过`enableTracking`方法重新启用
- 以及当前活跃的订阅者是否是这个`Dep`对应的计算属性（避免读取自身导致死循环）。

如果任一条件不满足，则直接中断执行

接下来，我们看到有两个分支判断，我们先看第一个

```ts
let link = this.activeLink

if (link === undefined || link.sub !== activeSub) {
    link = this.activeLink = new Link(activeSub, this)

    // 将当前link连接到当前活跃的订阅者的deps的双向链表尾部
    // 主要用于执行完依赖后清除已执行的依赖
    if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link
    } else {
        // 链表操作，将当前link放到已有的activeSub的尾部
        link.prevDep = activeSub.depsTail
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link
    }

    // 添加订阅者
    addSub(link)
}
```

当`this.activeLink`未定义，或者它的订阅者不是当前活跃的订阅者时，我们会创建一个新的`Link`对象，并将其赋值给
`this.activeLink`。

- `link === undefined`这种情况好理解，就是当前`Dep`还没有任何订阅者的场景
- `link.sub !== activeSub`这种情况则是当前`Dep`
  已经有订阅者了，但是这个订阅者不是当前活跃的订阅者，这种情况可能会出现在多个订阅者依赖同一个响应式属性的场景，例如:
    ```ts
    const foo = reactive({ a: 1 })
    
    effect(() => {
        console.log('effect1', foo.a)
    })
    
    effect(() => {
        console.log('effect2', foo.a)
    })
    ```
  这里effect1就对应了`link === undefined`，effect2就对应了`link.sub !== activeSub`

创建完`Link`之后，我们会将这个`Link`对象添加到当前活跃的订阅者的依赖链表中，这样做的好处是，当这个订阅者执行完毕后，我们可以通过这个链表来清理不再需要的依赖。

接下来，我们调用了`addSub(link)`方法，这个方法的作用是将这个`Link`对象添加到当前`Dep`的订阅者链表中。

```ts
function addSub(link: Link) {
    // 订阅者计数
    link.dep.sc++
    if (link.sub.flags & EffectFlags.TRACKING) {
        const computed = link.dep.computed
        // computed getting its first subscriber
        // enable tracking + lazily subscribe to all its deps
        // computed接受第一个订阅者
        if (computed && !link.dep.subs) {
            // 将computed的状态置为TRACKING和DIRTY
            computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
            // 递归computed的所有依赖，挂上订阅者
            for (let l = computed.deps; l; l = l.nextDep) {
                addSub(l)
            }
        }

        // 将当前link加到当前dep的订阅者链表尾部
        const currentTail = link.dep.subs
        if (currentTail !== link) {
            link.prevSub = currentTail
            if (currentTail) currentTail.nextSub = link
        }

        // 设置为当前dep的头节点，方便按序执行onTrigger钩子函数
        if (__DEV__ && link.dep.subsHead === undefined) {
            link.dep.subsHead = link
        }

        // 将当前link设置为当前dep的尾节点
        link.dep.subs = link
    }
}
```

这个方法主要做了以下几件事：

- 增加订阅者计数（`sc`）,方便后续判断是否需要清理依赖
- 如果当前`Dep`是一个计算属性，并且这是它的第一个订阅者，则将计算属性的状态置为`TRACKING`和`DIRTY`，并递归地为它的所有依赖添加订阅者。
- 将当前`Link`对象添加到`Dep`的订阅者链表中。

接下来，我们来看第二个分支 {#version}

```ts
else
if (link.version === -1) {
    // reused from last run - already a sub, just sync version
    link.version = this.version

    // If this dep has a next, it means it's not at the tail - move it to the
    // tail. This ensures the effect's dep list is in the order they are
    // accessed during evaluation.
    // 如果这个 dep 有 next，则表示它不在尾部
    // 将其移动到尾部
    // 这可确保effect的 dep 列表按照评估期间访问它们的顺序排列。
    if (link.nextDep) {
        // link的上下游链接在一起，相当于把当前link从链表中删除
        const next = link.nextDep
        next.prevDep = link.prevDep
        if (link.prevDep) {
            link.prevDep.nextDep = next
        }

        // 把当前link放到尾节点
        link.prevDep = activeSub.depsTail
        link.nextDep = undefined
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link

        // this was the head - point to the new head
        // 如果link是首节点，则重新指向下一个节点
        if (activeSub.deps === link) {
            activeSub.deps = next
        }
    }
}
```

这个分支主要处理的是当前`Link`对象已经是当前活跃订阅者的依赖了，但是它的版本是`-1`，这表示它是从上一次执行中复用过来的。

- 首先，我们将它的版本同步为当前`Dep`的版本。
- 然后，我们检查它是否有`nextDep`，如果有，说明它不在链表的尾部，我们需要将它移动到尾部，以确保依赖链表的顺序与访问顺序一致。
- 最后，如果这是链表的头节点，我们需要更新头节点指向下一个节点。

细心的你会发现这里是**else if**分支，这意味着这还有一个隐藏的**else**分支，这个分支就是当前`Link`对象已经是当前活跃订阅者的依赖，并且它的版本不是
`-1`，也就是说它已经是最新的了，我们不需要做任何操作，直接跳过即可。

一个最简单的例子就是同一个订阅者订阅了不止一次数据

```ts
const r = reactive({foo: 1})
effect(() => {
    return r.foo + r.foo
})
```

这个例子的`r.foo`会被访问两次，但是实际上我们只需要订阅一次就可以了，第二次访问时，`link.sub === activeSub`且
`link.version !== -1`，所以直接跳过。

最后，如果是在开发环境，并且当前活跃的订阅者有`onTrack`钩子函数，我们会调用这个钩子函数，传入一些调试信息, 最后返回这个
`link`。

```ts
// 如果是开发环境，并且当前活跃的订阅者有onTrack钩子函数，则调用该函数
if (__DEV__ && activeSub.onTrack) {
    activeSub.onTrack(
        extend(
            {
                effect: activeSub,
            },
            debugInfo,
        ),
    )
}

return link
```

## `trigger`函数 {#trigger}

现在我们回过头来看看`trigger函数的实现`(不是`Dep`的`trigger`方法)

```ts
export function trigger(
    target: object,
    type: TriggerOpTypes,
    key?: unknown,
    newValue?: unknown,
    oldValue?: unknown,
    oldTarget?: Map<unknown, unknown> | Set<unknown>,
): void {
    const depsMap = targetMap.get(target)
    if (!depsMap) {
        // 未被调用，所以没有相关追踪
        // never been tracked
        globalVersion++
        return
    }

    const run = (dep: Dep | undefined) => {
        if (dep) {
            // 调用dep对象的trigger方法
            if (__DEV__) {
                dep.trigger({
                    target,
                    type,
                    key,
                    newValue,
                    oldValue,
                    oldTarget,
                })
            } else {
                dep.trigger()
            }
        }
    }

    /**
     * 开始批量执行
     * 主要是为了合并多次变更，避免重复执行，并确保computed和副作用等按照正确的执行顺序执行
     * 提升性能和一致性
     * 具体场景包括但不限于下面的depsMap.forEach等
     * 见effect.ts里的startBatch和endBatch方法
     */
    startBatch()

    if (type === TriggerOpTypes.CLEAR) {
        // collection being cleared
        // trigger all effects for target
        // 执行对象存储的所有依赖
        depsMap.forEach(run)
    } else {
        // 判断是否数组和key是否数组索引
        const targetIsArray = isArray(target)
        const isArrayIndex = targetIsArray && isIntegerKey(key)

        if (targetIsArray && key === 'length') {
            const newLength = Number(newValue)
            depsMap.forEach((dep, key) => {
                if (
                    // key是length
                    key === 'length' ||
                    // 或者key是遍历标记
                    key === ARRAY_ITERATE_KEY ||
                    // 或者key不是标记并且key（索引值）大于新的数组长度
                    (!isSymbol(key) && key >= newLength)
                ) {
                    run(dep)
                }
            })
        } else {
            // schedule runs for SET | ADD | DELETE
            // add set delete可以 以undefined为key
            if (key !== void 0 || depsMap.has(void 0)) {
                run(depsMap.get(key))
            }

            // 数组索引的话还要触发迭代类型的依赖
            // schedule ARRAY_ITERATE for any numeric key change (length is handled above)
            if (isArrayIndex) {
                run(depsMap.get(ARRAY_ITERATE_KEY))
            }

            // 根据对象的类型去获取需要触发的依赖
            // 同时还要在ADD | DELETE | Map.SET等操作中执行iteration key的依赖
            // also run for iteration key on ADD | DELETE | Map.SET
            switch (type) {
                case TriggerOpTypes.ADD:
                    if (!targetIsArray) {
                        run(depsMap.get(ITERATE_KEY))
                        if (isMap(target)) {
                            run(depsMap.get(MAP_KEY_ITERATE_KEY))
                        }
                    } else if (isArrayIndex) {
                        // new index added to array -> length changes
                        run(depsMap.get('length'))
                    }
                    break
                case TriggerOpTypes.DELETE:
                    if (!targetIsArray) {
                        run(depsMap.get(ITERATE_KEY))
                        if (isMap(target)) {
                            run(depsMap.get(MAP_KEY_ITERATE_KEY))
                        }
                    }
                    break
                case TriggerOpTypes.SET:
                    if (isMap(target)) {
                        run(depsMap.get(ITERATE_KEY))
                    }
                    break
            }
        }
    }

    // 需要触发的订阅者队列建立完毕
    // 开始执行
    endBatch()
}
```

首先获取该响应式对应的依赖，如果没有依赖，则直接终止执行

```ts
const depsMap = targetMap.get(target)
if (!depsMap) {
    // 未被调用，所以没有相关追踪
    // never been tracked
    globalVersion++
    return
}
```

因为不同场景可能不止一次运行`dep.trigger()`, 所以我们定义了一个`run`函数来统一调用

```ts
const run = (dep: Dep | undefined) => {
    if (dep) {
        // 调用dep对象的trigger方法
        if (__DEV__) {
            dep.trigger({
                target,
                type,
                key,
                newValue,
                oldValue,
                oldTarget,
            })
        } else {
            dep.trigger()
        }
    }
}
```

`startBatch`、`batch`、`endBatch`这几个批量处理函数适合单开另说，[点击这跳转](#batch)。目前大家只需知道这三个函数都是用来批量处理的。

然后我们进入下面的逻辑

```ts
if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    // 执行对象存储的所有依赖
    depsMap.forEach(run)
} else {
    // 判断是否数组和key是否数组索引
    const targetIsArray = isArray(target)
    const isArrayIndex = targetIsArray && isIntegerKey(key)

    if (targetIsArray && key === 'length') {
        const newLength = Number(newValue)
        depsMap.forEach((dep, key) => {
            if (
                // key是length
                key === 'length' ||
                // 或者key是遍历标记
                key === ARRAY_ITERATE_KEY ||
                // 或者key不是标记并且key（索引值）大于新的数组长度
                (!isSymbol(key) && key >= newLength)
            ) {
                run(dep)
            }
        })
    } else {
        // schedule runs for SET | ADD | DELETE
        // add set delete可以 以undefined为key
        if (key !== void 0 || depsMap.has(void 0)) {
            run(depsMap.get(key))
        }

        // 数组索引的话还要触发迭代类型的依赖
        // schedule ARRAY_ITERATE for any numeric key change (length is handled above)
        if (isArrayIndex) {
            run(depsMap.get(ARRAY_ITERATE_KEY))
        }

        // 根据对象的类型去获取需要触发的依赖
        // 同时还要在ADD | DELETE | Map.SET等操作中执行iteration key的依赖
        // also run for iteration key on ADD | DELETE | Map.SET
        switch (type) {
            case TriggerOpTypes.ADD:
                if (!targetIsArray) {
                    run(depsMap.get(ITERATE_KEY))
                    if (isMap(target)) {
                        run(depsMap.get(MAP_KEY_ITERATE_KEY))
                    }
                } else if (isArrayIndex) {
                    // new index added to array -> length changes
                    run(depsMap.get('length'))
                }
                break
            case TriggerOpTypes.DELETE:
                if (!targetIsArray) {
                    run(depsMap.get(ITERATE_KEY))
                    if (isMap(target)) {
                        run(depsMap.get(MAP_KEY_ITERATE_KEY))
                    }
                }
                break
            case TriggerOpTypes.SET:
                if (isMap(target)) {
                    run(depsMap.get(ITERATE_KEY))
                }
                break
        }
    }
}
```

这里的逻辑代码比较多，我们逐步解析：

- 首先判断操作类型是否是`CLEAR`，如果是，则说明整个集合被清空了，我们需要触发所有的依赖。
- 然后判断目标对象是否是数组，以及操作的键是否是数组的索引，如果目标对象是数组，并且操作的键是`length`，则我们需要触发所有与
  `length`相关的依赖，包括那些索引大于新长度的依赖。
- 如果目标对象不是数组，或者操作的键不是`length`，则我们根据操作类型（`SET`、`ADD`、`DELETE`）来触发相应的依赖。
    - 首先需要触发`key`本身的依赖
    - 如果是数组的话还要触发迭代器的依赖
    - 如果是`ADD`操作，需要根据对象类型触发迭代器的依赖
    - 如果是`DELETE`操作，同样需要根据对象类型触发迭代器的依赖
    - 如果是`SET`操作，仅有`Map`类型触发迭代器的依赖

总的来说，这段代码的目的是确保在响应式数据发生变化时，所有相关联的依赖都能被正确地触发，从而保证视图的更新，而不是仅仅只触发
`key`对应的依赖。
比如你修改了数组中某个项的值，那么如果依赖中包含了遍历相关依赖，那么也需要触发该依赖

```ts
const r = ref([1])
effect(() => {
    console.log(r.value[0])
})
effect(() => {
    r.value.forEach(item => console.log(`loop ${item}`))
})
r.value[0] = 2
// 执行输出
// 1
// loop 1
// 2
// loop 2
```

### `Dep`的`trigger`方法 {#deptrigger}

那么上面我们可以看到`run`函数包装的正是对`Dep`的`trigger`方法的调用，我们来看下这个方法的实现：

```ts
class Dep {
    trigger(debugInfo?: DebuggerEventExtraInfo): void {
        // version+1，可以快速判断依赖是否变化，如无变化可以避免一些重复计算（主要是computed的）
        this.version++
        globalVersion++
        this.notify(debugInfo)
    }
}
```

可以看到这里只是对`version`和`globalVersion`进行了+1操作，然后调用了`notify`方法。
这两个version主要是用于标识依赖的版本变化，方便在某些场景下进行优化，例如避免重复计算和无用依赖清理。

然后我们看看`notify`方法：{#depnotify}

```ts
class Dep {
    notify(debugInfo?: DebuggerEventExtraInfo): void {
        startBatch()
        try {
            if (__DEV__) {
                // subs are notified and batched in reverse-order and then invoked in
                // original order at the end of the batch, but onTrigger hooks should
                // be invoked in original order here.
                // 触发通知函数是按照倒序，但是在批处理结束时按原始顺序调用，所以这里的 onTrigger 钩子函数应该按原始顺序调用。
                // 具体可以看下effect的notify方法以及effect.ts里的batch startBatch和endBatch方法
                for (let head = this.subsHead; head; head = head.nextSub) {
                    if (head.sub.onTrigger && !(head.sub.flags & EffectFlags.NOTIFIED)) {
                        head.sub.onTrigger(
                            extend(
                                {
                                    effect: head.sub,
                                },
                                debugInfo,
                            ),
                        )
                    }
                }
            }
            // 倒序遍历订阅者，触发通知函数
            for (let link = this.subs; link; link = link.prevSub) {
                // 执行结果为true意味着是computed，则继续执行ComputedRefImpl的notify方法
                if (link.sub.notify()) {
                    // if notify() returns `true`, this is a computed. Also call notify
                    // on its dep - it's called here instead of inside computed's notify
                    // in order to reduce call stack depth.
                    ;(link.sub as ComputedRefImpl).dep.notify()
                }
            }
        } finally {
            // 结束批量执行
            endBatch()
        }
    }
}
```

这个方法主要做了以下几件事：{#endbatchfn}

- 首先调用`startBatch`方法，开始一个批量处理的上下文，这样可以合并多次变更，避免重复执行，并确保computed和副作用等按照正确的执行顺序执行。
- 如果是在开发环境，并且当前`Dep`有订阅者链表头（`subsHead`），则按顺序遍历这个链表，调用每个订阅者的`onTrigger`钩子函数。
- 然后按倒序遍历订阅者链表（`subs`），调用每个订阅者的`notify`方法。如果`notify`方法返回`true`
  ，则说明这个订阅者是一个计算属性，我们需要进一步调用它的依赖的`notify`方法。
- 最后调用`endBatch`方法，结束批量处理的上下文。

## vue的发布订阅模型

看到这里，你是否会被一个又一个的`trigger`、`notify`绕的有点晕？别急，我们这里紧急插入补充一节，来讲讲Vue的发布订阅模型。

在经典的发布订阅模型中，通常会有一个中心化的事件总线（Event Bus），所有的**订阅者（Subscribers）**都会注册到这个事件总线上，当
**发布者（Publishers）**发布一个事件时，事件总线会通知所有注册的订阅者。

一个简单的例子:

```ts
class EventBus {
    private eventMap = new Map<string, Set<Function>>()

    constructor() {
    }

    subscribe(event: string, fn: Function) {
        if (!this.eventMap.has(event)) {
            this.eventMap.set(event, new Set())
        }
        this.eventMap.get(event)!.add(fn)
    }

    publish(event: string, ...args: any[]) {
        const fns = this.eventMap.get(event)
        if (fns) {
            fns.forEach(fn => fn(...args))
        }
    }
}

const eventBus = new EventBus()

// 订阅一个事件
eventBus.subscribe('eatFood', (food: string) => {
    console.log(`I am eating ${food}`)
})
// 发布一个事件
eventBus.publish('eatFood', 'apple')
```

对应到Vue的响应式系统中：

- 事件总线对应的是`Dep`类的实例，每个响应式属性都会有一个对应的`Dep`实例来管理它的订阅者。
- 订阅者对应的是实现了`Subscriber`接口的类的实例，例如`ReactiveEffect`和`ComputedRefImpl`。
- 发布者对应的是对响应式属性的修改操作，例如通过`reactive`或者`ref`创建的响应式数据被修改。

但是`Dep`作为事件中心，并没有像经典的发布订阅模型那样提供了`subscribe`方法来显式的注册一个订阅者，而是通过`track`
函数间接的实现了订阅者的注册。

- `Subscriber`执行副作用函数前把自己赋值给`activeSub`，表示当前活跃的订阅者
- 副作用函数执行过程中，触发响应式属性的`get`操作，然后调用`track`函数
- `track`函数读取`activeSub`，并把它注册到对应的`Dep`实例中，这样完成了事件的订阅
- 响应式对象属性变更，触发`trigger`函数
- 进而调用对应`Dep`实例的`trigger`方法和`notify`方法，通知所有订阅者。也就是你可以理解为`Dep`实例的`trigger`方法对应经典模型中的
  `publish`方法
- 最后，执行`Subscriber`的`notify`方法，完成事件的发布和订阅事件回调函数的执行

## `effect`函数 {#effect}

`effect`函数是Vue响应式系统的核心，它用于注册一个副作用函数，当响应式数据变化时，这个副作用函数会被重新执行。我们来看下它的实现：

```ts
export function effect<T = any>(
    fn: () => T,
    options?: ReactiveEffectOptions,
): ReactiveEffectRunner<T> {
    // 判断fn是否存在effect并且是ReactiveEffect的实例
    // 避免自身嵌套问题
    if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
        fn = (fn as ReactiveEffectRunner).effect.fn
    }

    // 实例化ReactiveEffect函数
    const e = new ReactiveEffect(fn)
    // 如果存在options，合并到实例
    if (options) {
        extend(e, options)
    }
    try {
        // 运行实例
        e.run()
    } catch (err) {
        e.stop()
        throw err
    }
    const runner = e.run.bind(e) as ReactiveEffectRunner
    // 将实例挂在到执行器函数的effect属性上
    runner.effect = e
    return runner
}
```

- 首先，它检查传入的函数`fn`是否已经是一个`ReactiveEffect`实例的副作用函数，如果是，则提取出原始函数，避免嵌套问题。
- 然后，它创建一个新的`ReactiveEffect`实例，并将传入的函数赋值给这个实例。
- 如果传入了`options`，则将这些选项合并到`Reactive
- 执行`run`函数
- 将`run`包装为`runner`并将本实例挂载到`runner.effect`属性上，方便后续访问
- 返回`runner`

### 然后我们来看下`ReactiveEffect`类的实现：

老规矩，先看看挂载了哪些属性

```ts
export class ReactiveEffect<T = any>
    implements Subscriber, ReactiveEffectOptions {
    /**
     * @internal
     */
    deps?: Link = undefined
    /**
     * @internal
     */
    depsTail?: Link = undefined
    /**
     * @internal
     */
    flags: EffectFlags = EffectFlags.ACTIVE | EffectFlags.TRACKING
    /**
     * @internal
     */
    next?: Subscriber = undefined
    /**
     * @internal
     */
    cleanup?: () => void = undefined

    scheduler?: EffectScheduler = undefined
    onStop?: () => void
    onTrack?: (event: DebuggerEvent) => void
    onTrigger?: (event: DebuggerEvent) => void

    constructor(public fn: () => T) {
        // 判断是否有活跃的作用域，有的话放到作用域中
        if (activeEffectScope && activeEffectScope.active) {
            activeEffectScope.effects.push(this)
        }
    }
}
```

- `deps`和`depsTail`：分别表示这个副作用函数依赖的响应式属性的双向链表的头节点和尾节点。
- `flags`：表示这个副作用函数的状态，例如是否活跃，是否正在追踪依赖等。
- `next`: 用于将多个订阅者连接成一个链表，方便批量处理。
- `cleanup`：一个可选的清理函数，在副作用函数停止时调用。
- `scheduler`：一个可选的调度函数，用于自定义副作用函数的执行时机。
- `onStop`、`onTrack`和`onTrigger`: 分别是副作用函数停止、追踪依赖和触发依赖时的钩子函数。
- `fn`：这是传入的副作用函数，当响应式数据变化时，这个函数会被重新执行。

### `run`方法 {#run}

```ts
class ReactiveEffect {
    run(): T {
        // 如果当前实例不是活跃状态，直接执行fn并返回执行结果
        if (!(this.flags & EffectFlags.ACTIVE)) {
            // stopped during cleanup
            return this.fn()
        }

        // 设为执行状态
        this.flags |= EffectFlags.RUNNING
        // 执行cleanup函数, cleanup函数在onEffectCleanup中注册
        cleanupEffect(this)
        // 初始化依赖
        prepareDeps(this)
        // 将当前的活跃订阅设为本实例
        const prevEffect = activeSub
        const prevShouldTrack = shouldTrack
        activeSub = this
        shouldTrack = true

        try {
            // 运行函数
            return this.fn()
        } finally {
            if (__DEV__ && activeSub !== this) {
                warn(
                    'Active effect was not restored correctly - ' +
                    'this is likely a Vue internal bug.',
                )
            }
            // 清除未执行的依赖
            cleanupDeps(this)
            // 状态回滚
            activeSub = prevEffect
            shouldTrack = prevShouldTrack
            // 退出运行状态
            this.flags &= ~EffectFlags.RUNNING
        }
    }
}
```

- 如果当前实例不是活跃状态（`ACTIVE`标志未设置），则直接执行传入的函数并返回结果。因为这里还没设置`activeSub`，所以不会被收集到依赖
- 设置为执行状态
- 执行`cleanupEffect`函数，这个函数会调用`cleanup`函数（如果有的话），用于清理副作用函数之前的状态。可以通过`onEffectCleanup`
  注册清理函数
- 初始化依赖，主要是将已经挂载的`link`的`version`置为-1，在执行的过程中，`track`
  函数会将[link的version与dep的version同步](#version)，
  而`dep`的version初始值为0，并且随每次`trigger`的触发累加,所以如果当前订阅者被执行了，那么version就不会为-1，可以用于后续的清理未执行的订阅者的判断
- 核心来咯：**将全局变量`activeSub`设置为本实例,`shouldTrack`设置为true**
  。这也是上面发布订阅章节和再往前的Demo章节等多次提到过的，如何订阅者与响应式属性建立联系的关键
- 执行`fn`函数，在这个过程中，任何被访问的响应式属性都会调用`track`函数，从而将这个副作用函数注册为它们的订阅者
- 执行完毕后，进行一些清理和回退工作：
    - 如果是在开发环境，并且`activeSub`不是当前实例，说明在执行过程中`activeSub`被修改了，发出警告
    - 调用`cleanupDeps`函数，清理那些未被执行的依赖
    - 将`activeSub`和`shouldTrack`恢复到之前的状态
    - 将状态标志中的`RUNNING`标志清除，表示副作用函数已经执行完毕

### `notify`方法 {#effectnotify}

接下来我们看下`notify`方法的实现，[订阅者的notify方法的调用在上面提到过](#depnotify)。

```ts
class ReactiveEffect {
    /**
     * @internal
     */
    notify(): void {
        // 如果运行中且不允许递归，则跳过
        if (
            this.flags & EffectFlags.RUNNING &&
            !(this.flags & EffectFlags.ALLOW_RECURSE)
        ) {
            return
        }
        // 还未被通知过，则执行batch。batch会将本实例标记为已通知
        // 所以这个判断就有去重的作用了，确保在同一次批处理中只会被通知一次
        if (!(this.flags & EffectFlags.NOTIFIED)) {
            batch(this)
        }
    }
}
```

- 首先，它检查当前副作用函数是否正在运行，并且不允许递归执行（`ALLOW_RECURSE`标志未设置）。如果是这种情况，则直接返回，避免重复执行。
- 然后，它检查当前副作用函数是否已经被通知过（`NOTIFIED`标志未设置）。如果没有被通知过，则调用`batch`
  函数，将这个副作用函数添加到批处理队列中。这样可以确保在同一次批处理中，这个副作用函数只会被执行一次，避免重复执行。

那么至此，[startBatch](#depnotify), [batch](#effectnotify), [endBatch](#depnotify)
都已经到齐，我们终于可以聊聊，在依赖触发时，vue到底如何进行批量处理执行副作用函数的了

## 批量处理实现 {#batch}

### `startBatch`方法

```ts
let batchDepth = 0

export function startBatch(): void {
    // 记录批处理的处理深度
    batchDepth++
}
```

很简单，维护了一个全局变量`batchDepth`，每次调用`startBatch`时，`batchDepth`加1，表示进入了一个新的批处理上下文。

### `batch`方法

```ts
let batchedSub: Subscriber | undefined
let batchedComputed: Subscriber | undefined

export function batch(sub: Subscriber, isComputed = false): void {
    // 标记为已通知
    sub.flags |= EffectFlags.NOTIFIED
    /**
     * 分别维护一个普通的订阅队列和一个computed的订阅队列
     * computed的队列执行状态回滚到非NOTIFIED状态，computed的依赖已经在notify的时候放入到普通订阅队列了
     *
     * 因为批量处理时，是通过倒叙遍历链表来执行订阅的通知函数
     * 所以这里得到的链表是反过来的，也就是回到了正序
     */
    if (isComputed) {
        sub.next = batchedComputed
        batchedComputed = sub
        return
    }
    sub.next = batchedSub
    batchedSub = sub
}
```

- 首先，它将传入的订阅者（`sub`）的标志设置为`NOTIFIED`，表示这个订阅者已经被通知过了。
- 然后，它根据`isComputed`参数，将订阅者添加到不同的队列中：
    - 如果`isComputed`为`true`，则将订阅者添加到`batchedComputed`队列中，这个队列专门用于存放计算属性的订阅者。
    - 如果`isComputed`为`false`，则将订阅者添加到`batchedSub`队列中，这个队列用于存放普通的订阅者。

[我们在Dep.notify方法中遍历订阅者时](#depnotify)，是从链尾开始遍历的，所以这里添加订阅者时，是将新的订阅者放在链表的头部，这样在遍历时就能按正确的顺序执行。

### `endBatch`方法

```ts
export function endBatch(): void {
    if (--batchDepth > 0) {
        return
    }

    if (batchedComputed) {
        // 将computed的执行状态回滚到非NOTIFIED状态
        let e: Subscriber | undefined = batchedComputed
        batchedComputed = undefined
        while (e) {
            const next: Subscriber | undefined = e.next
            e.next = undefined
            e.flags &= ~EffectFlags.NOTIFIED
            e = next
        }
    }

    let error: unknown
    while (batchedSub) {
        let e: Subscriber | undefined = batchedSub
        batchedSub = undefined
        // 循环执行订阅的通知函数
        while (e) {
            // 将已执行的订阅从batchedSub链表中移除
            const next: Subscriber | undefined = e.next
            e.next = undefined
            // 重置NOTIFIED状态
            e.flags &= ~EffectFlags.NOTIFIED
            if (e.flags & EffectFlags.ACTIVE) {
                try {
                    // 执行依赖的trigger函数
                    // ACTIVE flag is effect-only
                    ;(e as ReactiveEffect).trigger()
                } catch (err) {
                    if (!error) error = err
                }
            }
            e = next
        }
    }

    if (error) throw error
}
```

- 首先，它将`batchDepth`减1，如果`batchDepth`仍然大于0，说明还有嵌套的批处理上下文没有结束，直接返回。
- 如果`batchedComputed`不为空，则代表这次批量处理包含computed，则将`batchedComputed`队列中的所有订阅者的`NOTIFIED`
  标志清除，表示它们可以在下一次批处理时再次被通知。
  在遍历dep.notify时，computed的依赖已经被放入到普通订阅队列了，所以这里不需要执行computed的trigger方法
- 然后，它开始处理`batchedSub`队列中的订阅者：
    - 将其从队列中移除，并清除它的`NOTIFIED`标志。
    - 如果订阅者是活跃的（`ACTIVE`标志设置），则调用它的`trigger`方法，执行副作用函数。
    - 如果在执行过程中发生错误，则捕获错误并存储起来，稍后统一抛出。
- 最后，如果在执行过程中捕获到了错误，则将其抛出。

**那么这样批量处理的好处是什么呢？**

- 避免重复执行：在同一次批处理中，同一个副作用函数即使被多次通知，也只会执行一次，避免了不必要的重复计算。
- 保持执行顺序：通过维护两个队列（普通订阅者和计算属性订阅者），确保了副作用函数的执行顺序符合预期，特别是计算属性的依赖关系。
- 错误处理：在批量执行过程中，如果某个副作用函数抛出错误，其他副作用函数仍然会继续执行，最后统一抛出错误，避免了单个错误阻塞整个批处理。

## 串联整个流程

到这里，我们已经了解了Vue响应式系统的核心机制，包括依赖收集、触发更新以及批量处理等。下面我们来串联一下整个流程，帮助大家更好地理解这些机制是如何协同工作的。列一个简单的例子：

```ts
const state = reactive({count: 0})
effect(() => {
    console.log(`count is: ${state.count}`)
})
state.count++
```

解析一下这里的运行流程

- [创建响应式对象](./reactive.md)
- [执行effect函数](#effect)
- 实例化`ReactiveEffect`，创立一个订阅者
- [执行run方法](#run)，将订阅者实例赋值到全局属性`activeSub`
- 运行副作用函数，触发`proxy`的`get`操作拦截，调用[track函数](#track)
- `track`函数实例化[Dep对象](#dep),执行[dep.track方法](#deptrack)，建立与订阅者的联系
- 执行完副作用函数后，回退`activeSub`，`shouldTrack`等全局属性，`run`方法执行完毕
- 执行`state.count++`,修改响应式数据，触发`proxy`的`set`操作拦截，调用[trigger函数](#trigger)
- `trigger`函数获取对应的`Dep`实例，执行[dep.trigger方法](#deptrigger)
- 处理`version`后，执行[dep.notify方法](#depnotify)
- `notify`方法调用[startBatch](#depnotify)开始批量处理
- 遍历订阅者链表，调用每个订阅者的[notify方法](#effectnotify)
- `notify`方法调用[batch方法](#batch)将订阅者添加到批处理队列中
- `notify`方法执行完毕，调用[endBatch](#endbatch)结束批量处理
- `endBatch`方法调用每个订阅者的`trigger`方法，执行副作用函数
- `trigger`方法执行完毕，`endBatch`方法执行完毕，整个流程结束

## 总结

本章内容为vue响应式核心中的核心，如果一遍看不懂可以多看几遍。建议：
1. 还是建议先看看[demo](./demo.md),对整个流程有一个大致的了解
2. 不熟悉链表操作的，先补补数据结构相关知识，最起码先弄懂链表
3. 了解发布订阅模型，带着这个概念去读代码
4. 可以通过debug用例，多跑跑代码的执行流程，观察流程中一些关键变量的数据