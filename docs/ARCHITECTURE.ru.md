# `@stakeplate/core` — архитектура и использование

> Как собрать Stake Engine слот, относясь к ядру как к **чёрному ящику**: вы отдаёте
> четыре «шва», ядро делает всё остальное — рукопожатие с RGS, загрузку, HUD,
> валюту/юрисдикцию, соответствие требованиям Stake, повтор раунда (replay),
> восстановление активного раунда, ошибки — и гоняет цикл раунда.

---

## 1. Что это такое

`@stakeplate/core` — это опубликованная «батарейка» для игр на Stake Engine. Цель —
**~1000 разных игр на одной архитектуре**: вместо того чтобы копировать инфраструктуру
(RGS-транспорт, boot, FSM-фазы, MobX-сторы, compliance-UI) из игры в игру и накапливать
расхождения, все эти слои живут в одном версионируемом пакете. Исправили баг один раз —
подняли версию — его получили все игры.

Игра поставляет **только своё**: сцену (pixi-рендер), фазу `Present` (проигрывание
раунда), чистую функцию `interpretBook` и конфиг. Всё остальное — внутри ящика.

**Три слоя вокруг ядра** (тоже опубликованы, ядро их только оркеструет):

| Слой | Пакет | За что отвечает |
|---|---|---|
| HUD + весь compliance-UI | `@open-slot-ui/*` | кнопки, валюта, соц-режим, replay-модалки, ошибки, buy-confirm, RTP/net/session, лимиты автоплея |
| Аудио-микшер | `@schmooky/zvuk` | шины, gain, дакинг, спрайты, музыка |
| Барабаны (boards) | `pixi-reels` | `ReelSet`, `HoldAndWinBoard`, `HorizontalReel` |

---

## 2. Модель «чёрного ящика»

```
                     ┌─────────────────────────────────────────────┐
   ВЫ ДАЁТЕ           │              @stakeplate/core               │        ВЫ ПОЛУЧАЕТЕ
                     │                                             │
   config ──────────▶│  boot: runtime → network → HUD →           │──────▶ смонтированный
   interpretBook ───▶│        authenticate(language!) →           │        совместимый HUD
   mountView ───────▶│        configure(currency/juris/social) →  │
   Present-фаза ────▶│        resume | replay → FSM               │──────▶ рабочий цикл
   (audio?) ────────▶│                                             │        раунда
                     │  round: Idle → Spin → Present → Settle      │
                     │  ошибки → блокирующий boot-error/модалка    │──────▶ соответствие
                     └─────────────────────────────────────────────┘        Stake «из коробки»
```

Вы **не заглядываете внутрь**. Вы не пишете свою модалку, не форматируете валюту, не
дёргаете `fetch` к RGS, не считаете RTP на клиенте. Всё это — контракт ящика.

---

## 3. Быстрый старт

Вся игра — один вызов `createStakeGame` (пример из `examples/basic-slot`):

```ts
import { createStakeGame, roundEvents, type Phase } from '@stakeplate/core';
import { MiniSlot } from './MiniSlot';       // ваша pixi-сцена
import { DemoNetwork } from './demoNetwork';  // в проде — не нужен, ядро само идёт в RGS

type Ev = { grid: string[][] };              // тип событий book — объявляется ОДИН раз
type Data = { grid: string[][]; win: boolean };

// Ваша фаза Present: проиграть раунд на сцене, затем передать в settle.
const present: Phase<Data, MiniSlot, Ev> = {
  name: 'present',
  async enter(ctx) {
    if (ctx.round) await ctx.view.play(ctx.round.data.grid, ctx.round.data.win);
    await ctx.fsm.transition('settle');
  },
};

const game = createStakeGame<Data, MiniSlot, Ev>({
  // Лестница ставок, ставка по умолчанию и порог подтверждения покупки приходят от RGS/
  // юрисдикции (здесь — из `authenticate` мока), НЕ из конфига. `rtp` — только для показа.
  config: {
    title: 'Basic Slot',
    rtp: 96,
  },
  // Единственный «денежный шов». `raw` типизирован как `Round<Ev>` → `roundEvents(raw)`
  // это `Ev[]`, без cast. Выигрыш/множитель считает ядро (серверо-авторитетно).
  interpretBook: (raw, info): Data => {
    const ev = roundEvents(raw)[0];
    return { grid: ev?.grid ?? [[], [], []], win: info.totalWin > 0 };
  },
  mountView: (host) => new MiniSlot(host),
  phases: [present],
  hudHost: document.getElementById('hud')!,
  sceneHost: document.getElementById('scene')!,
});

await game.start();
```

`start()` проходит весь совместимый boot без участия игры. Игра физически **не может**
забыть отправить `language` в `authenticate` (частый баг → `400`), пропустить
восстановление активного раунда или потерять флаг compliance.

---

## 4. Четыре шва, которые даёте вы

### 4.1. `config: GameConfig`

Декларативное описание игры. Ядро строит из него UISpec для HUD. Обратите внимание, чего
здесь **нет**: лестницы ставок, ставки по умолчанию и порога подтверждения покупки — всё это
серверо-авторитетно (см. §5) и приходит из `authenticate`/юрисдикции, а не из конфига.

```ts
interface GameConfig {
  title: string;
  version?: string;
  currency?: string;              // фолбэк; сессия/`?currency=` побеждает
  rtp?: number;                   // ТОЛЬКО показ (readout/правила); сервер/report — истина
  modes?: Record<string, ModeConfig | number>; // base, bonus, … с их cost-множителями
  rules?: unknown;                // содержимое меню/правил (compliance)
  spec?: Record<string, unknown>; // сырой проброс в mountHud (крайние случаи)
}
```

> Лестница ставок (`betLevels`), ставка по умолчанию (`defaultBetLevel`) и порог
> `confirmBuyAboveCost` берутся из `auth.config` / юрисдикции. Игра лишь объявляет, что режим
> — покупка (`modes.bonus.buy = true`); порог подтверждения — политика Stake, не выбор игры.

### 4.2. `interpretBook: (raw: Round<E>, info) => T` — единственный «денежный шов»

Чистая функция «сырой book из RGS → ваша модель раунда». **Парсит только события**
(символы, каскады, бонус). `raw` типизирован вашим типом события `E` (объявляется на
`createStakeGame<Data, View, E>`), поэтому вы видите **реальные данные сервера типизированно**,
а не `unknown`. Деньги считает ядро:

```ts
interface RoundInfo {
  mode: string;
  bet: number;          // базовая ставка
  cost: number;         // множитель стоимости режима
  stake: number;        // bet × cost
  multiplier: number;   // payoutMultiplier / 100
  totalWin: number;     // производный: multiplier × bet
  payout: number;       // АВТОРИТЕТНЫЙ выигрыш сервера (raw.payout); фолбэк — totalWin
}

type InterpretBook<T, E> = (raw: Round<E>, info: RoundInfo) => T;
```

Полный ответ сервера доступен в `raw` (`betID`, `amount`, `payout`, `payoutMultiplier`,
события через `roundEvents(raw): E[]`, `active`). Правило: клиент «тупой» и серверо-
авторитетный — никакого paytable/evaluateWin/RTP на клиенте, только разбор присланного.
Когда `payout` и `totalWin` расходятся — доверяйте `payout` (это сумма сервера).

### 4.3. `mountView: (host, ctx) => V`

Монтирует вашу pixi-сцену (барабаны, презентер, сторы) и возвращает объект `view`,
который потом получают фазы. Единственный рендер, который пишет автор игры.

### 4.4. Фаза `Present` (и опционально `audio`)

Ядро уже даёт фазы `Idle` / `Spin` / `Settle`. Вы пишете **только `Present`** — как
проиграть раунд на сцене. `phases` дописываются поверх дефолтных, поэтому фаза с тем же
именем переопределяет дефолтную.

---

## 5. Что делает ящик сам

| Требование | Владелец |
|---|---|
| `authenticate {sessionID, **language**}`, `play {mode, **currency**, amount}`, end-round, event, replay-GET | **ядро** (транспорт) |
| Разбор всех launch-параметров (rgs_url, sessionID, lang, currency, social, device, replay-набор) | **ядро** (runtime) |
| Boot: auth → конфиг HUD → **восстановление активного раунда** → **блокирующий boot-error** | **ядро** (boot) |
| **Replay** (модалка → чистый раунд → модалка, UI заблокирован) | **ядро** ведёт, HUD рисует |
| Юрисдикция, `minimumRoundDuration`, RGS-код → модалка, `reportRound`/net | **ядро** связывает, HUD показывает |
| Белый набор иконок HUD по умолчанию (спин/турбо/автоплей/±, spin-skin) | **ядро** подключает `loadBuiltinArt()` |
| Аудио-шины + бинд на слайдеры/mute HUD + дакинг + preload | **ядро** на `@schmooky/zvuk` |
| Валюта/соц-режим/buy-confirm/скрытый fullscreen/max-win/replay+error UI/автоплей | **HUD** (`@open-slot-ui`) |
| `interpretBook`, сцена + презентер, фаза Present, тексты правил, звуки, математика | **игра** |

---

## 6. Публичный API (поверхность ящика)

```ts
const game = createStakeGame<T, V>(options);

interface StakeGame {
  start(): Promise<void>;   // весь совместимый boot + запуск FSM
  dispose(): void;          // без утечек: снимает реакции, HUD, pixi-app
  inspect(): GameSnapshot;  // { phase, balance, bet, lastWin, currency, spinning } — для харнесса/тестов
  requestSpin(): boolean;   // программный спин (как кнопка HUD), только из Idle
}
```

`inspect()` и `requestSpin()` — это шов для **декларативного харнесса** (postMessage +
Playwright): состояние проверяется интроспекцией, без скриншотов.

### Подпакеты (subpaths), ESM-only

| Импорт | Что внутри |
|---|---|
| `@stakeplate/core` | `createStakeGame` + движок + типы |
| `@stakeplate/core/rgs` | wire-протокол, runtime, `StakeNetworkManager`, `MockNetworkManager` |
| `@stakeplate/core/stores` | базовые MobX-сторы `Balance` / `Session` / `Ui` |
| `@stakeplate/core/audio` | `createGameAudio`, `bindAudioToHud` (шины zvuk) |
| `@stakeplate/core/testing` | `InstantTicker`, `MockNetworkManager`, `mockHud()` |

Пиры (peer deps): `@open-slot-ui/core`, `@open-slot-ui/pixi`, `@schmooky/zvuk`,
`pixi-reels`, `pixi.js@^8`. Собственная зависимость — только `mobx`.

---

## 7. Жизненный цикл раунда (FSM)

```
        requestSpin()/кнопка HUD
   Idle ─────────────────────────▶ Spin ───────▶ Present ───────▶ Settle ───▶ Idle
   (ждём спин)                     │             (ВАША фаза)      (баланс+     (готово)
                                   │              проигрыш         reportRound)
                                   │              раунда)
                                   └─ ошибка ─▶ refund + модалка ─▶ Idle
```

- **Idle** — ждёт спин; `spinning=false`.
- **Spin** — выбирает режим → списывает ставку (`debitStake`) → `network.play` →
  `interpretBook` → кладёт распарсенный раунд в `ctx.round` → переход в Present.
  При ошибке — возврат ставки + `showRgsError`/`showError` → Idle.
- **Present** — **ваша фаза**: анимируете `ctx.round.data` на сцене → `settle`.
- **Settle** — применяет авторитетный баланс + выигрыш, `hud.reportRound`, выдерживает
  `minimumRoundDuration` → Idle.

`PhaseContext`, который получает каждая фаза:

```ts
interface PhaseContext<T, V> {
  config; stores; network; hud; ticker; view: V; audio;
  interpretBook;
  fsm;                      // fsm.transition('present' | 'settle' | …)
  round: GameRound<T> | null;   // текущий распарсенный раунд
  modeCost(mode): number;
}
```

---

## 8. Деньги: единицы

- **API-единицы** — целые, `× 1e6` (`1.00` → `1_000_000`). Транспорт конвертирует сам.
- **BOOK-единицы** — `payoutMultiplier × 100`. Ядро приводит: `multiplier =
  payoutMultiplier / 100`, `totalWin = multiplier × bet`.
- Все суммы в сторах и в `config.bets` — **мажорные** (человеческие) единицы.

Вам достаточно вернуть из `interpretBook` события; суммы уже посчитаны в `info`.

---

## 9. Ассеты (pixi)

Ядро **не грузит ассеты игры** — оно владеет только HUD, boot-сплэшем и `showBootError`.
Текстуры, атласы, spine грузит **ваша сцена** в `mountView` через pixi `Assets` (сцена —
единственный рендер, который пишет игра).

```ts
import { Assets } from 'pixi.js';
import atlasUrl from './assets/symbols.json'; // импорт → бандлер подставит хэш + относит. URL

class MyScene {
  private ready: Promise<void>;
  constructor(host: HTMLElement, ctx: ViewContext) { this.ready = this.init(host); }

  private async init(host: HTMLElement): Promise<void> {
    await this.app.init({ backgroundAlpha: 0 /* … */ });
    host.appendChild(this.app.canvas);
    const sheet = await Assets.load(atlasUrl); // грузим атлас/спрайтшит/spine
    this.build(sheet);
  }

  async play(round): Promise<void> { await this.ready; /* … анимируем раунд … */ }
}
```

- **Boot-сплэш.** Ваш `#boot` div прячется, когда `game.start()` зарезолвится (auth + монтаж
  HUD). Сцена грузит ассеты параллельно — держите `ready`-промис и `await this.ready` в начале
  `play()`, тогда первый спин дождётся ассетов. Ошибка загрузки → бросьте из `mountView`, ядро
  покажет блокирующий `showBootError`.
- **Сборка под Stake (единый бандл, относительные пути).** Stake раздаёт игру с глубокого CDN-
  подпути, поэтому: `vite build` с `base: './'`; **импортируйте** ассеты (`import url from
  './x.png'`), не хардкодьте абсолютные пути; крупную бинарку (spine `.skel`/атласы) кладите в
  бандл, мелочь можно инлайнить (data-URI) ради одного самодостаточного файла.

---

## 10. Звук — `@stakeplate/core/audio`

Тонкая обёртка над `@schmooky/zvuk`: стандартный граф шин (master → `music` / `sfx` /
`ambience`), привязка к слайдерам HUD и дакинг музыки под sfx. Игра только объявляет звуки.

```ts
import { createGameAudio, bindAudioToHud } from '@stakeplate/core/audio';
import spinUrl from './sfx/spin.mp3';
import winUrl from './sfx/win.mp3';
import baseLoop from './music/base.mp3';

const audio = createGameAudio({ buses: { music: 0.8, sfx: 1 } }); // + дакинг music ← sfx

const game = createStakeGame<Data, View, Ev>({
  // …config, interpretBook, mountView…
  audio,                                    // фазы зовут ctx.audio.play('win') / music('base')
  mountView: (host, ctx) => {
    bindAudioToHud(audio, ctx.hud);          // Music/Effects слайдеры + mute (persist в localStorage)
    const off = ctx.hud.on('spinRequested', () => { void audio.unlock(); off(); }); // разблок на 1-м жесте
    void audio.load([                        // preload манифеста на шины
      { name: 'spin', url: spinUrl },                // → шина sfx по умолчанию
      { name: 'win',  url: winUrl, bus: 'sfx' },
      { name: 'base', kind: 'music', loop: baseLoop }, // + intro? / outro?
    ]);
    return new MyScene(host, ctx);
  },
});
```

Из фаз (или сцены):

```ts
ctx.audio?.play('win');                    // на шину sfx; музыка сама «пригибается» (дакинг)
ctx.audio?.music('base', { fadeIn: 0.4 }); // сменяет текущий трек с кроссфейдом
ctx.audio?.stopMusic({ fade: 0.3 });
```

| API | Что делает |
|---|---|
| `createGameAudio({ buses?, masterHeadroom?, duckMusicFrom?, duckAmount? })` | поднять микшер (шины + limiter + дакинг) |
| `audio.load(entries)` | preload звуков/музыки на шины |
| `audio.play(name, { bus?, volume? })` | сыграть звук (по умолчанию `sfx`) |
| `audio.music(name, { fadeIn? })` · `stopMusic({ fade? })` | музыка (кроссфейд текущей) |
| `audio.unlock()` | resume AudioContext с жеста (1 раз) + армирует дакинг |
| `audio.bus(name)` | шина zvuk (`.level` 0..1, `.muted`, `fadeTo`, FX-вставки) |
| `bindAudioToHud(audio, hud, { storageKey? })` | Music→music, Effects→sfx (persist), Sound-toggle→mute всех шин; возвращает disposer |

- **Шины по умолчанию:** master → `music` (0.8) / `sfx` (1) / `ambience` (0.6); master headroom
  −3 dB + limiter. Свои уровни — в `createGameAudio({ buses })`.
- **Дакинг:** `music` пригибается, пока звучит `sfx` (`duckMusicFrom: 'sfx'`, `duckAmount` 0.5);
  `duckMusicFrom: null` — выключить.
- **Разблокировка обязательна** с пользовательского жеста (браузер не играет звук до этого) —
  поэтому `audio.unlock()` на первом спине.

> `@stakeplate/core/audio` — отдельный подпакет: если звук не нужен, вы его не импортируете и
> `@schmooky/zvuk` в бандл не попадает.

---

## 11. Тестирование без бэкенда

`@stakeplate/core/testing` + `/rgs`:

- **`MockNetworkManager`** — авторитетный фейковый RGS: баланс, юрисдикция, активный
  раунд; скриптуется через `forceRound({ payoutMultiplier | win, stake?, events?, active? })` —
  можно форсировать выигрыш 5000×, бонус, восстановление раунда посреди спина.
- **`InstantTicker`** — задержки резолвятся мгновенно, «часы» ядра идут вперёд → весь
  раунд проходит headless в юнит-тесте.
- **`inspect()` / `requestSpin()`** — драйвите состояние и проверяйте снапшот, без pixi
  и без скриншотов.

```ts
const net = new MockNetworkManager({ balance: 1000, currency: 'USD', modes: { base: 1 } });
net.forceRound({ payoutMultiplier: 500, events: [{ grid: winningGrid }] }); // 5.00×
```

---

## 12. Граница ответственности

**Ваше (внутри игры):** сцена и барабаны, презентер, фаза `Present`, `interpretBook`,
`config`, тексты правил, звуки, математика (на этапе сборки).

**Ящика (не трогаете):** RGS-транспорт и все его фиксы, разбор launch-параметров, boot и
восстановление, replay, модалки ошибок, валюта/юрисдикция/соц-режим, привязка аудио к
HUD, набор иконок HUD по умолчанию, цикл раунда.

### Чего НЕ делать

- ❌ Не писать свой `fetch` к RGS, свою модалку ошибки, своё форматирование валюты — всё
  это уже есть и протестировано.
- ❌ Не считать выигрыш/RTP на клиенте — сервер авторитетен, вы только разбираете book.
- ❌ Не рендерить свою кнопку fullscreen — в iframe Stake ей владеет платформа (ядро
  скрывает её через spec).
- ✅ Нужно другое поведение? Переопределите фазу (та же `name`), передайте свои иконки/
  spin-skin через `hudOptions`, или свой `network` — расширяйте по швам, не вскрывайте ящик.

---

## 13. TL;DR

```
Дайте: config + interpretBook + mountView + Present-фазу.
Вызовите: await createStakeGame(...).start().
Получите: совместимую с Stake игру, которая грузится, играет, восстанавливается,
          повторяет раунд и обрабатывает ошибки — без вашего кода на всё это.
```
