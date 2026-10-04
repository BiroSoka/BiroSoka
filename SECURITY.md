# Security policy

## Reporting a problem

Please **do not** open a public issue for a security problem. Instead, use GitHub's private reporting:

**Repository > Security > Report a vulnerability**

(If that button is not there, contact the maintainer privately: `<your contact email>`.)

Please include what you found, how to reproduce it, and what you think the impact is. We will reply as soon as we can,
tell you what we plan to do, and credit you when it is fixed if you would like that.

## What is worth reporting

- A way to cheat the server's referee (for example, scoring without a legal flick, moving someone else's pen, or
  playing out of turn).
- A way to crash or freeze the server, or to use a lot of its memory or CPU.
- A way to read or change another player's game or private room.
- Script injection through names or messages.
- Anything that exposes personal data.

## How the game handles data

This helps you judge impact:

- There are **no accounts, no passwords and no database**. Rooms live in the server's memory and disappear when the
  room ends or the server restarts.
- Typed messages are passed straight to the other players and are **never stored or logged**.
- A player's name, chosen pen, and progress (stats, streak, unlocked pens) stay in their own browser's local storage.
- Rooms are joined with a short random code, and each seat has a private random token that lets a player rejoin.
- The server re-simulates every flick itself and checks whose turn it is, so clients are not trusted.

## Supported versions

Only the latest version on the `main` branch is supported.
