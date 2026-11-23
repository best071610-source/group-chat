# Комната — групповой чат

Статическое одностраничное приложение для GitHub Pages. Регистрация и вход используют JWT API, а сообщения передаются по WebSocket.

## Запуск

Откройте `index.html` или включите GitHub Pages для ветки `main` (корень репозитория). Сборка и сервер не требуются.

## Подключённые адреса

- API: `https://inai-col3.fishrungames.com/api`
- Чат: `wss://inai-col3.fishrungames.com/chat/`

Контракт REST API описан в [Swagger](https://inai-col3.fishrungames.com/api/docs/). После регистрации или входа access-токен хранится только в `sessionStorage` текущей вкладки. Refresh-токен остаётся в HttpOnly cookie бэкенда. При подключении первым сообщением WebSocket отправляется `AUTH`; поле ввода становится доступно только после `AUTH_SUCCESS`.

## GitHub Pages

GitHub Pages публикует корень ветки `main` по адресу `https://best071610-source.github.io/laba-9/`. Приложение использует относительные пути к CSS и JavaScript и не требует сборки.
