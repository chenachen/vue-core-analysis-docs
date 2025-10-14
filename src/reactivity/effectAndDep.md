# Effect & Dep

还记得我们在[Demo](./demo.md)或者[Reactive](./reactive.md)源码中提到的`track`和`trigger`吗？它们是实现响应式系统的核心机制。今天，我们将深入探讨它们的实现原理以及它们在Vue 3中的具体应用。

## `track`函数

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
- 检查是否应该进行依赖收集（`shouldTrack`）以及是否有活跃的副作用函数（`activeSub`）。
- 从`targetMap`中获取对应的`depsMap`，如果不存在则创建一个新的`Map`。
- 从`depsMap`中获取对应的`dep`，如果不存在则创建一个新的`Dep`对象。
- 最后调用`dep`的`track`方法进行依赖收集。

这已经和我们在[Demo](./demo.md)中实现的`track`函数非常相似了。

主要的区别在于，我们这里使用了一个`Dep`类来管理依赖，而不是直接使用`Set`。这样做的好处是可以更好地封装依赖管理的逻辑。

## `Dep`类的实现

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

    track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {}

    trigger(debugInfo?: DebuggerEventExtraInfo): void {}

    notify(debugInfo?: DebuggerEventExtraInfo): void {}
}
```

先来看看`Dep`类的属性：
- `version`：依赖的版本控制，主要用于缓存结果和清理无用依赖。
- `activeLink`：指向当前活跃的副作用相关的Link链接。
- `subs`和`subsHead`：分别表示订阅者的双向链表的尾节点和头节点。
- `map`和`key`：用于对象属性依赖的清理。
- `sc`：订阅者计数器，用于判断是否需要清理依赖。
- `computed`：如果这个`Dep`是用于计算属性的，则会存储对应的`ComputedRefImpl`实例。
- `__v_skip`：用于标识这个对象不需要被Vue的响应式系统处理。
- `track`、`trigger`和`notify`方法：分别用于依赖收集、触发依赖和通知订阅者。

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
- 否有活跃的副作用函数（`activeSub`），例子是使用`reactive`等定义的响应式数据，并不是通过`effect`函数去执行的，这样是无法有效的捕捉到依赖的
- 是否应该进行依赖收集（`shouldTrack`），这个变量主要用于控制依赖收集的开关，例如在某些情况下我们可能不希望进行依赖收集
- 以及当前活跃的副作用函数是否是这个`Dep`对应的计算属性（避免死循环）。

如果任一条件不满足，则直接中断执行

接下来，我们看到又两个分支判断，我们先看第一个

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

当`this.activeLink`未定义，或者它的订阅者不是当前活跃的副作用函数时，我们会创建一个新的`Link`对象，并将其赋值给`this.activeLink`。
- `link === undefined`这种情况好理解，就是当前`Dep`还没有任何订阅者的场景
- `link.sub !== activeSub`这种情况则是当前`Dep`已经有订阅者了，但是这个订阅者不是当前活跃的副作用函数，这种情况可能会出现在多个副作用函数依赖同一个响应式属性的场景，例如:
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

创建完`Link`之后，我们会将这个`Link`对象添加到当前活跃的副作用函数的依赖链表中，这样做的好处是，当这个副作用函数执行完毕后，我们可以通过这个链表来清理不再需要的依赖。

接下来

```mermaid
graph TD
    A[开始] --> B{判断条件?};
    B -- 是 --> C[执行操作1];
    B -- 否 --> D[执行操作2];
    C --> E[结束];
    D --> E;