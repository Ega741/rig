# Testnet Deployment — запись об исполнении

Этот документ написан **по факту**, а не как план заранее: шаги были короткими и известными из спеки §8, отдельный план не составлялся.

**Дата:** 2026-09-14. **Сеть:** Robinhood Chain testnet, chain id 46630, RPC `https://rpc.testnet.chain.robinhood.com`. **Спека:** §8 п.1.

## Что задеплоено

| Что | Адрес | Проверка |
|---|---|---|
| `MockERC20` (стенд-ин токена) | `0x6a2831ae6085d7E24A8a4DAd8486f47A66ae3f4C` | verified на Blockscout |
| `HashMine` | `0xe80B2B24dfB92e14A4294273C1b14Ec42c4c15E4` | verified на Blockscout; `token()`, `roundLength 600`, `releaseBps 48`, `targetShares 4096`, `minDifficultyFloor 20`, `rewardPool 1e24` прочитаны ончейн |
| Деплоер (одноразовый, только testnet) | `0xCeb7fefD392AA5fb7AF729b8e7d3Ad0757f357F4` | ключ в `contracts/.env` (gitignore, mode 600); пополнен через кран на 0.01 ETH, деплой стоил 0.0000247 ETH |

Запись деплоя: `contracts/deployments-testnet.json`, broadcast — `contracts/broadcast/DeployTestnet.s.sol/46630/`. Explorer: `https://explorer.testnet.chain.robinhood.com/address/0xe80B2B24dfB92e14A4294273C1b14Ec42c4c15E4`.

## Скрипты

- `contracts/script/DeployTestnet.s.sol` — мок-токен + `HashMine` с боевыми параметрами §5.1, 1 000 000 токенов в пул. Ключ из `DEPLOYER_KEY`.
- `contracts/script/TopUp.s.sol` — долив пула (`TOPUP_TOKENS`, по умолчанию 10 000), заменяет `harvest()` в сети без PONS:

```bash
cd contracts && set -a && . ./.env && set +a && HASHMINE_ADDRESS=0xe80B2B24dfB92e14A4294273C1b14Ec42c4c15E4 forge script script/TopUp.s.sol:TopUp --rpc-url robinhood_testnet --broadcast
```

## Сайт

- `web/.env.testnet` — `VITE_CHAIN=testnet`, `VITE_HASHMINE_ADDRESS=…`; сборка `vite build --mode testnet`, dev `vite --mode testnet`.
- Локальный dev-сервер против testnet (`.claude/launch.json` в Claudiii, конфиг `rig-web-testnet`, порт 5190).
- Хостинг: Vercel, проект `rig` (team ega741), домен `rig.fan` (куплен пользователем в Vercel 2026-09-14). Деплой: `cd web && vercel --prod --yes`; `vercel.json` собирает `npm run build:testnet`. Первый деплой упал: Vercel заливает только `web/`, а векторы хэшей лежали в `contracts/` — копия перенесена в `web/src/engine/vectors/`, синхронизация в `scripts/export-abi.sh`.

## Смок против настоящей сети (не anvil)

1. Страница с `?beneficiary=<деплоер>` показала сеть, beneficiary и сессионный ключ `0x8CdAb155dB74f12F1C06cB71D0ce57446c87BF31`.
2. Сессионный ключ пополнен с деплоера на 0.003 ETH (tx `0xeb4e6bdf…d0771`).
3. Start mining: GPU apple metal-3, 107 MH/s; сеть — минимум 20 бит, клиент выбрал 32; 17 шар найдено на прогреве (24 бита) за первые секунды.
4. Контракт в testnet принял **4 батча, 29 шар** от beneficiary за первый раунд: 17 на 24 бита (прогрев), 10 + 1 + 1 на 32 бита; tx `0xb69b35ae…`, `0x3543e8f7…`, `0x96d25977…`, `0x2065c5d5…` (блоки от 119 336 085). Это первая проверка не на anvil.
5. Во время смока пользователь потребовал не грузить машину больше чем на 50%. Майнер остановлен; добавлен потолок нагрузки (см. спеку §6.2): скважность в CPU-воркерах и GPU-цикле, `MAX_INTENSITY = 50`, ядер не больше половины, ползунок «Load cap» на лету. Измерено в headless Chromium: CPU 42% занятости, GPU 50% (при 100% — 100/100).

## Найдено по ходу

- До нажатия Start страница не показывает раунд, пул и pending («—», «0.00»): состояние читается только контроллером. Исправить: читать `roundState` и до старта (хвост).
- Кран `faucet.testnet.chain.robinhood.com` отдаёт curl'у 429; в браузере выдаёт 0.01 ETH. Этого хватает на сотни транзакций при газе 0.01 gwei.
- Blockscout testnet принимает `forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api` без ключа.
