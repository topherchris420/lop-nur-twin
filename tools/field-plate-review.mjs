import puppeteer from "puppeteer";
const browser = await puppeteer.launch({headless:"shell",args:["--no-sandbox"]});
try {
  for (const [name,width,height] of [["desktop",1280,720],["phone",412,844]]) {
    const page = await browser.newPage();
    await page.setViewport({width,height,deviceScaleFactor:1});
    const errors = [];
    page.on("pageerror",e=>errors.push(String(e)));
    await page.evaluateOnNewDocument(()=>{
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind,...rest) {
        if (kind.includes("webgl")) return null;
        return original.call(this,kind,...rest);
      };
    });
    await page.goto("http://127.0.0.1:5173/",{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>{
      const c = document.querySelector(".lakebed-plate");
      return c?.width > 300 && c.getContext("2d").getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data[3] === 255;
    },{timeout:90000});
    const valid = await page.evaluate(()=>{
      const links = [...document.querySelectorAll(".airfield-print nav a")];
      return links.map(a=>a.pathname).join() === "/analysis,/compare" && links.every(a=>{
        const b=a.getBoundingClientRect();
        return b.x>=0 && b.right<=innerWidth+1 && b.y>=0 && b.bottom<=innerHeight+1;
      }) && document.documentElement.scrollWidth<=innerWidth;
    });
    if (errors.length || !valid) throw new Error(name + " visibility or page errors: " + errors.join());
    await page.screenshot({path:"shots/review/" + name + ".png"});
    console.log(name,width,height,"painted and both navigation links visible");
    await page.close();
  }
} finally { await browser.close(); }
