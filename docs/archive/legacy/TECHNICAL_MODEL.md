# Техническая модель тактического прототипа

Документ переводит правила из [`1.BASE_OBJECTS.md`](1.BASE_OBJECTS.md), [`TACTICAL_LOOP.md`](TACTICAL_LOOP.md) и [`2. MANEUVERS.md`](2.%20MANEUVERS.md) в структуры данных и контракты. Имена приведены как ориентир и не требуют конкретного языка программирования.

## 1. Версия модели

- Версия: `movement-playtest-1`
- Статус: `Playtest`
- Цель: проверить выбор позиции, курса и риска в боях из 2–5 юнитов.
- Источник правил: Markdown-документы имеют приоритет над текущим HTML/JavaScript-прототипом.

## 2. Координаты

```text
HexCoord
  q: integer
  r: integer

neighbors(): HexCoord[6]
distanceTo(other): integer
isInside(bounds): boolean
```

Направления курса имеют индексы `0..5`. Поворот на `+1` или `-1` меняет курс на 60°.

## 3. Состояние боя

```text
BattleState
  roundNumber: integer
  phase: Deployment | RoundStart | Activation | RoundEnd | Finished
  units: Unit[]
  hexContents: Map<HexCoord, HexContent>
  initiativeOrder: UnitId[]
  activeUnitId: UnitId | null
  winner: SideId | Draw | null
```

```text
HexContent
  unitId: UnitId | null
  terrain: Terrain | null
  hazards: Hazard[]
  objects: BattlefieldObject[]
```

Инвариант: `unitId` содержит не более одного юнита.

`canMove` вычисляется как наличие хотя бы одного допустимого маршрута с одним или более шагами. Стояночный поворот не считается маршрутом; `Speed = 0`, отсутствие допустимого соседнего гекса и активный перехват без уже успешного отрыва дают `canMove = false`. `canAttack` означает наличие хотя бы одной допустимой пары «оружие — цель». Юнит боеспособен, если `canMove || canAttack || canAttemptDisengage`; последняя проверка применима только к связанной эскадрилье.

## 4. Юниты

```text
Unit
  id: UnitId
  sideId: SideId
  position: HexCoord
  initiative: integer
  baseSpeed: integer
  currentSpeed: integer
  integrity: integer
  maxIntegrity: integer
  hasActivated: boolean
  hasWaited: boolean
  canMove: boolean
  canAttack: boolean
```

```text
CapitalShip extends Unit
  heading: 0..5
  maneuver: 0..3
  mass: number
  engine: EngineModule
  reactor: ReactorModule
  evasionPenaltyUntilActivation: boolean
```

```text
Squadron extends Unit
  squadronType: Interceptor | Bomber | Fighter
  stack: 1..5
  unitHealthMax: integer
  totalHealth: integer
  engagedWith: UnitId[]
```

`totalHealth` не может превышать `stack * unitHealthMax`. После урона размер стека равен округлению оставшегося здоровья вверх до целого аппарата.

## 5. Модули

```text
ShipModule
  id: ModuleId
  name: string
  kind: Primary | Secondary | Hardpoint
  mass: number
  powerConsumption: number
  stability: 0..100
  position: ShipSector
  criticalStates: CriticalState[]
```

```text
EngineModule extends ShipModule
  thrustPower: number
  massCapacity: number
  overheat: 0..100
```

```text
ReactorModule extends ShipModule
  capacity: number
  rechargeRate: number
  currentEnergy: number
```

В начале активации:

```text
currentEnergy = min(capacity, currentEnergy + rechargeRate)
```

Формула штрафа двигателя остаётся отдельным балансируемым параметром и не должна быть неявно зашита в поиск маршрута.

## 6. Матрица движения и размещения

| Движущийся юнит | Содержимое гекса | Проход | Остановка |
|---|---|---:|---:|
| Капитальный корабль | Капитальный корабль | Нет | Нет |
| Капитальный корабль | Эскадрилья | Нет | Нет |
| Эскадрилья | Капитальный корабль | Да | Нет |
| Эскадрилья | Эскадрилья | По правилу перехвата | Нет |
| Любой юнит | Крупный объект | Нет | Нет |
| Любой юнит | Местность | По типу | По типу |
| Любой юнит | Опасность | По типу | По типу |

Таран является отдельной командой и не меняет обычную матрицу проходимости.

## 7. Контракт содержимого гекса

```text
TraversalRule
  canEnter(unit): boolean
  canStop(unit): boolean
  movementCost(unit): integer
  preview(unit, route): ConsequencePreview[]
  onEnter(unit, battle, rng): Effect[]
  onStay(unit, battle, rng): Effect[]
  onExit(unit, battle, rng): Effect[]
```

```text
ConsequencePreview
  sourceName: string
  probability: 0..1
  minValue: number | null
  maxValue: number | null
  effectType: string
```

Каждый вход запускает новую проверку `onEnter`, даже если юнит уже входил в этот гекс в текущей активации.

## 8. Маршрут

```text
RouteRequest
  unitId: UnitId
  destination: HexCoord
  policy: Safe | Risky
```

```text
Route
  steps: RouteStep[]
  movementCost: integer
  turnsSpent: integer
  finalHeading: 0..5 | null
  consequences: ConsequencePreview[]
  ramTargetId: ObjectId | null
```

```text
RouteStep
  from: HexCoord
  to: HexCoord
  headingBeforeMove: 0..5 | null
  turn: -1 | 0 | +1
```

Ограничения капитального корабля:

- `movementCost <= currentSpeed`;
- `turnsSpent <= maneuver`;
- перед одним шагом допускается не более одного поворота;
- после последнего шага допускается один дополнительный поворот на 60°, если остался бюджет;
- при `maneuver = 0` доступно только движение прямо.

Политики:

- `Safe`: исключить маршруты с отрицательными проверяемыми последствиями; среди остальных минимизировать стоимость движения, затем число поворотов.
- `Risky`: выбрать маршрут с минимальной стоимостью движения независимо от избегаемых опасностей; при равенстве минимизировать число поворотов, затем ожидаемый ущерб.

Поиск обязан возвращать вероятность и диапазон каждого последствия до подтверждения.

## 9. Уклонение

Тестовая таблица `movement-playtest-1`:

| Пройдено гексов | Бонус уклонения |
|---:|---:|
| 0 | 0 п.п. |
| 1 | 5 п.п. |
| 2 | 9 п.п. |
| 3 | 12 п.п. |
| 4 | 14 п.п. |
| 5+ | 15 п.п. |

Действие `EvasiveManeuver` умножает бонус на `1.5`; итоговый бонус ограничен 25 п.п.

```text
movementEvasion = min(25, table[traveledStepCount] * actionMultiplier)
finalEvasion = clamp(baseEvasion + movementEvasion + otherModifiers, 0, evasionCap)
```

Значения `baseEvasion` и `evasionCap` задаются боевой системой. Стояночный разворот устанавливает `finalEvasion = 0` до начала следующей активации этого корабля независимо от базового значения и иных модификаторов; броня, щиты и укрытие не затрагиваются.

## 10. Порядок инициативы

Сортировка в начале раунда:

1. `initiative` по убыванию;
2. `currentSpeed` по убыванию;
3. открытый случайный ключ, один раз созданный для раунда.

Ожидание удаляет юнит с текущей позиции и помещает в конец очереди. `hasWaited = true` запрещает повторное ожидание до следующего раунда.

## 11. Команды и проверки

Минимальные команды первой версии:

```text
Wait(unitId)
UseSystemAction(unitId, actionId)
PlanRoute(unitId, destination, policy)
ConfirmMove(unitId, routeId)
RotateInPlace(unitId, signedTurns)
Disengage(squadronId)
Attack(attackerId, targetId, weaponId)
Ram(attackerId, targetId, routeId)
EndActivation(unitId)
```

Все команды сначала проходят чистую проверку допустимости, затем изменяют состояние. Предпросмотр маршрута и его последствий не изменяет состояние и не расходует генератор случайных чисел.

## 12. Тестовые векторы

- Корабль `Speed 5 / Maneuver 0` достигает только гексов прямо по текущему курсу.
- Корабль `Speed 3 / Maneuver 2` может повернуть на 60° перед двумя разными шагами, но не на 120° перед одним шагом.
- После маршрута с одним оставшимся очком корабль может довернуть на 60°.
- Стояночный корабль `Maneuver 3` может развернуться на 180° и имеет нулевое уклонение до начала следующей активации.
- Капитальный корабль не может войти в гекс эскадрильи.
- Эскадрилья может пройти через капитальный корабль, но не остановиться там.
- Повторный вход в один hazard создаёт отдельную проверку и отдельную строку предпросмотра.
- При равных Initiative и Current Speed порядок определяется сохранённым случайным ключом текущего раунда.