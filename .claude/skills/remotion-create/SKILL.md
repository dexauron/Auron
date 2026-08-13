---
name: remotion-create
description: Собрать новый ролик с нуля на Remotion. Используй, когда нужно СДЕЛАТЬ видео: рекламу для магазина, сторис или Reels про акцию, заставку, анимированный отчёт или короткий ролик из цифр и картинок.
version: 4.0.505
---

> **Врезка проекта Auron (не от автора скила).**
> Remotion — это React и Node: **к самому приложению Auron он отношения не
> имеет.** Наш фронт — один файл `webapp/Index.html` внутри Google Apps
> Script, там ни React, ни сборки нет, и ни одна строка отсюда в него не
> ложится. Анимации в приложении делаются по `emil-design-eng`.
>
> Этот набор — для отдельной задачи: **делать ролики про магазин** (реклама,
> сторис, заставки). Ролик собирается в отдельной папке и в репозиторий
> приложения не попадает.
>
> Взяты только тексты. Скрипты, картинки и вложенные копии других скилов не
> копировались.


These are instructions for making a new Remotion project and composition.  
If this is not the next task, see [Remotion Best Practices](../remotion-best-practices/SKILL.md)

## Scaffold a project

If a project already exists, skip this.
Ensure Node.js and Git is installed, and the current folder is appropriate for starting a new project.

Scaffold one using:

```bash
npx create-video@latest --yes --blank --no-tailwind my-video
cd my-video
npm i
```

Replace `my-video` with a suitable project name.

## Designing a video

Keep the scaffold and add React Markup.
Follow [Remotion React Markup Best Practices](../remotion-markup/SKILL.md) and [Video Layout Rules](video-layout.md) for video-first layout and text sizing guidance.

## Is this a multi-scene video?

If this is a video with multiple subsequence videos, follow guidance at [Multi-scene videos](../remotion-markup/multi-scene-video.md).

## Interactivity Best Practices

By structuring the React Markup following [Remotion Interactivity Best Practices](../remotion-interactivity/SKILL.md), you allow the user to make edits in the Studio which write back to code.

## TailwindCSS

If Tailwind is requested, see [tailwind.md](tailwind.md) for using TailwindCSS in Remotion.

## Open the preview

Start the preview server after building the composition:

```bash
npx remotion studio --no-open
```

This will start a long-running process and print the server URL for the preview.  
If the server is already started, it will print the URL.
If an in-harness browser is available, open it there.
You can visit a specific composition by navigating to `/[composition-id]`, for example `http://localhost:3000/MapAnimation`.

## Render the video

Only render if the user explicitly asks for it.

```
npx remotion render
```

For more options, see [Rendering](../remotion-render/SKILL.md).

## Follow-up

The video creation process has finished.
For follow-up prompts, use [Remotion Best Practices](../remotion-best-practices/SKILL.md)
