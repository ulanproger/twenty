# OIDC SSO: справочник и диагностика

## Адреса

| Назначение | Адрес |
|---|---|
| Начало входа | `GET <SERVER_URL>/auth/oidc-sso/login/<providerId>[?workspaceInviteHash=<hash>]` |
| Возврат из IdP (redirect URI) | `GET <SERVER_URL>/auth/oidc-sso/callback` |
| Админский и публичный API | `POST <SERVER_URL>/metadata` (GraphQL) |

`SERVER_URL` это публичный адрес сервера Twenty. Адрес в диалоге «Add OIDC provider» строится из него же.

## Параметры протокола

- Поток: Authorization Code, PKCE S256, scope `openid email profile`.
- `state`, `nonce` и PKCE-проверка одноразовые. Незавершённый вход живёт 10 минут, в одной браузерной сессии одновременно хранится не больше 5 незавершённых входов (старые вытесняются).
- Конфигурация IdP (discovery) кэшируется на 10 минут, запросы к IdP имеют таймаут 10 секунд. После смены настроек в IdP новая конфигурация подхватится не позже чем через 10 минут.
- id_token проверяется по подписи (ключи из `jwks_uri`), `nonce`, issuer и audience. Алгоритмы `none` и `HS*` не принимаются.
- Email берётся только из `email` и только при `email_verified` равном `true` (булево или строка `true` в любом регистре). Поля `upn`, `preferred_username` не читаются. Имя берётся из `given_name` и `family_name`.
- Аутентификация клиента на токен-эндпоинте: `client_secret_basic` или `client_secret_post`, выбирает библиотека `openid-client` по данным IdP.

## Переменные окружения

| Переменная | Для чего |
|---|---|
| `SERVER_URL` | Публичный адрес сервера, из него строится redirect URI. |
| `ENCRYPTION_KEY` | Ключ шифрования секретов клиентов IdP в базе. |
| `FALLBACK_ENCRYPTION_KEY` | Прежний ключ на время ротации (см. ниже). |
| `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` | Список хостов во внутренних сетях, к которым Twenty разрешено ходить (через запятую). Нужен, если IdP стоит в вашей закрытой сети. По умолчанию такие адреса заблокированы. |
| `NODE_ENV` | Только для локальной разработки: значение `development` разрешает Issuer по `http`. В продакшене не включайте, Issuer должен быть `https`. |

Новых переменных модуль не вводит.

Ротация ключа: задайте новый `ENCRYPTION_KEY`, а прежний положите в `FALLBACK_ENCRYPTION_KEY`, затем выполните команду `secret-encryption:rotate`. Секреты OIDC-провайдеров входят в список перешифровываемых. Команда идемпотентна.

## GraphQL API

Нужен токен пользователя с правом Security в нужном воркспейсе. Запросы идут на `/metadata` с заголовком `Origin` адреса воркспейса. Ошибки приходят с HTTP 200 и полем `errors`.

Получение токена по паролю (для пользователей, у которых пароль есть):

```bash
BASE=https://crm.example.com
LOGIN_TOKEN=$(curl -s $BASE/metadata -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"query":"mutation{getLoginTokenFromCredentials(email:\"admin@example.com\",password:\"...\",origin:\"'$BASE'\"){loginToken{token}}}"}' \
  | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
TOKEN=$(curl -s $BASE/metadata -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"query":"mutation{getAuthTokensFromLoginToken(loginToken:\"'$LOGIN_TOKEN'\",origin:\"'$BASE'\"){tokens{accessOrWorkspaceAgnosticToken{token}}}}"}' \
  | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
```

Пример ломается, если в пароле есть `"` или `\`: тогда собирайте JSON через `jq -n`. Для пользователей без пароля берите токен из сессии веб-интерфейса (не проверялось). Дальше `Authorization: Bearer $TOKEN`.

Список провайдеров (секрет не возвращается):

```graphql
query { oidcProviders { id name issuer clientId status } }
```

Создание. Поля: `name` до 255 символов, `issuer` до 2048, `clientId` до 255, `clientSecret` до 2048. Значения не должны быть пустыми.

```graphql
mutation {
  createOidcProvider(input: {
    name: "Corporate SSO"
    issuer: "https://idp.example.com/realms/main"
    clientId: "twenty"
    clientSecret: "..."
  }) { id name status }
}
```

Изменение. Меняются только `name` и `status` (`active` или `inactive`):

```graphql
mutation { updateOidcProvider(input: { id: "<uuid>", name: "New name", status: "inactive" }) { id name status } }
```

Удаление (возвращает `true`):

```graphql
mutation { deleteOidcProvider(input: { id: "<uuid>" }) }
```

Публичный список для экрана входа (без токена, только активные провайдеры воркспейса, найденного по `origin`):

```graphql
query { publicOidcProviders(origin: "https://crm.example.com") { name loginUrl } }
```

## Ограничения при создании

- Issuer: только `http` или `https` (`https` обязателен вне разработки), без `?`, `#`, логина и пароля. Конечные `/` отбрасываются: `https://idp/a/` и `https://idp/a` это один Issuer.
- При создании Twenty скачивает discovery и проверяет совпадение `issuer`, наличие `authorization_endpoint`, `token_endpoint`, `jwks_uri` и (если заявлено) поддержку S256.
- Пара Issuer и Client ID уникальна в воркспейсе. Лимита на число провайдеров нет.

## Модель безопасности

- Секрет клиента шифруется в базе версионным ключом, в API и интерфейс не отдаётся.
- `state` и `nonce` одноразовые, привязаны к сессии браузера, срок 10 минут.
- Вход по ссылке провайдера другого воркспейса отклоняется (провайдер должен принадлежать воркспейсу, на адрес которого пришёл пользователь). Подмена `workspaceInviteHash` на чужой отклоняется.
- Запросы к IdP идут через защиту от SSRF: адреса во внутренних сетях заблокированы, пока хост явно не разрешён.
- Email принимается только подтверждённым в IdP.
- Доверие к IdP задаёт администратор воркспейса. Он может выбрать любой IdP, и тот определяет, кто «подтверждённый пользователь» с каким email.

## Сообщения об ошибках

Пользователь видит либо текст из ядра Twenty, либо общий текст. Подробная причина попадает только в лог сервера строкой `OIDC sign-in failed: ...`.

| Что видит пользователь на `/verify` | Причина | Что делать |
|---|---|---|
| Single sign-on authentication failed | Любая ошибка IdP или проверки, детали в логе | Смотреть лог (таблица ниже) |
| User does not have access to this workspace | Новый пользователь без приглашения | Дать приглашение, войти по ссылке с `workspaceInviteHash` |
| Workspace is not ready to welcome new members | Воркспейс не активирован | Завершить онбординг воркспейса |

Причины в логе (после `OIDC sign-in failed:`):

| В логе | Значение | Действие |
|---|---|---|
| `OIDC identity rejected: email-missing` | В id_token нет `email` | Включить scope `email`, проверить маппинг в IdP |
| `OIDC identity rejected: email-not-verified` | Нет `email_verified=true` | Подтвердить email пользователя в IdP или настроить claim |
| `OIDC identity rejected: email-invalid` | Некорректный email | Исправить адрес в IdP |
| `OIDC provider access denied: provider-inactive` | Провайдер выключен | Включить провайдера |
| `OIDC provider access denied: workspace-mismatch` | Провайдер из другого воркспейса | Входить с адреса нужного воркспейса |
| `OIDC login missing` / `OIDC login expired` | Нет данных входа или прошло больше 10 минут, повтор callback, другой браузер | Начать вход заново с кнопки |
| `OIDC provider not found` | Провайдер удалён | Проверить ссылку, перезагрузить страницу входа |

## Таблицы провайдеров нет

Симптом: раздел OIDC на странице безопасности показывает ошибку, в логе сервера `relation "core.workspaceOidcProvider" does not exist`. Таблицу создаёт инстанс-команда, а обычный апгрейд пропускает её на базе, которая уже прошла эту версию Twenty. Стартовый скрипт образа вызывает `run-instance-commands` после `upgrade`, поэтому перезапуск контейнера сервера чинит это. Вручную: `node dist/command/command.js run-instance-commands` в контейнере сервера.
| `OIDC discovery rejected: ...` | `issuer-mismatch`, `endpoint-missing` или `pkce-s256-unsupported` | Исправить Issuer или настройки IdP |
| `Workspace invite hash is too long` | Слишком длинный `workspaceInviteHash` (более 255 символов) | Использовать корректную ссылку |

Ошибки при создании провайдера в интерфейсе и API:

| Код | Текст пользователю | Причина |
|---|---|---|
| `INVALID_ISSUER` | Invalid issuer URL. | Не `http(s)`, `http` вне разработки, есть `?`, `#` или логин и пароль |
| `ISSUER_DISCOVERY_FAILED` | Could not load the OpenID configuration from the issuer. | IdP недоступен, адрес заблокирован защитой от SSRF, нет discovery, не прошла проверка конфигурации |
| `PROVIDER_ALREADY_EXISTS` | This identity provider is already configured. | Такая пара Issuer и Client ID уже есть |
| `PROVIDER_NOT_FOUND` | Identity provider not found. | Неверный `id` при изменении или удалении |

## Диагностика

1. Проверьте discovery с машины, где работает сервер: `curl -s <issuer>/.well-known/openid-configuration`. Поле `issuer` должно совпадать с введённым.
2. Логи сервера: ищите `OIDC sign-in failed`. В Docker Compose: `docker compose logs server | grep "OIDC sign-in failed"`.
3. Если IdP во внутренней сети, а создание падает с `ISSUER_DISCOVERY_FAILED`, добавьте его хост в `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` и перезапустите сервер.
4. Redirect URI в IdP должен совпадать символ в символ с показанным в диалоге (схема, хост, порт, путь).
5. Если IdP не отдаёт `email_verified`, вход не заработает, настройте claim в IdP или смените IdP.

## Ограничения

См. [руководство](guide.md#чего-сейчас-нет). Дополнительно: живая проверка выполнялась только на тестовом IdP, второй воркспейс на одном инстансе, регресс входа через Google и Microsoft и реальные IdP из [рецептов](providers.md) не проверялись.
