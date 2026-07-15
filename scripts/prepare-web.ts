const html = await Bun.file("web-dist/index.html").text();
await Bun.write("web-dist/index.txt", html);
