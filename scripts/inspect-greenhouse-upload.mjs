import { chromium } from "playwright";
import path from "node:path";

const jobUrl = "https://tipalti.com/company/jobs/?gh_jid=5837192004&gh_src=my.greenhouse.search";
const resumePath = path.resolve("./resumes/My_resume.pdf");

function summarizeFileInputs(nodes) {
  return nodes.map((n, idx) => ({
    idx,
    name: n.name,
    id: n.id,
    accept: n.accept,
    required: n.required,
    hidden: n.hidden,
    ariaLabel: n.ariaLabel,
    className: n.className,
    labelText: n.labelText,
    ancestorPath: n.ancestorPath
  }));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const iframeSrcs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .map((f) => f.getAttribute("src") || "")
      .filter(Boolean)
  );

  const greenhouseSrc = iframeSrcs.find((src) => src.includes("greenhouse.io"));
  if (!greenhouseSrc) {
    console.log("No greenhouse iframe src found.");
    console.log("iframes:", iframeSrcs);
    process.exit(1);
  }

  console.log("Greenhouse iframe src:", greenhouseSrc);

  const formPage = await context.newPage();
  await formPage.goto(greenhouseSrc, { waitUntil: "domcontentloaded", timeout: 60000 });
  await formPage.waitForTimeout(2500);

  const before = await formPage.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input[type='file']"));
    const getAncestorPath = (el) => {
      const parts = [];
      let cur = el;
      let depth = 0;
      while (cur && depth < 5) {
        const id = cur.id ? `#${cur.id}` : "";
        const cls = cur.className && typeof cur.className === "string" ? `.${cur.className.split(/\s+/).filter(Boolean).slice(0,2).join(".")}` : "";
        parts.push(`${cur.tagName.toLowerCase()}${id}${cls}`);
        cur = cur.parentElement;
        depth += 1;
      }
      return parts.join(" <- ");
    };

    return {
      title: document.title,
      resumeHeader: Array.from(document.querySelectorAll("*"))
        .map((el) => el.textContent?.trim() || "")
        .find((t) => t.toLowerCase() === "resume/cv") || null,
      attachButtons: Array.from(document.querySelectorAll("button, [role='button']"))
        .map((el) => (el.textContent || "").trim())
        .filter((t) => ["attach", "dropbox", "enter manually"].includes(t.toLowerCase())),
      fileInputs: inputs.map((el) => {
        const labels = el.labels ? Array.from(el.labels).map((l) => (l.textContent || "").trim()).filter(Boolean) : [];
        return {
          name: el.getAttribute("name") || "",
          id: el.getAttribute("id") || "",
          accept: el.getAttribute("accept") || "",
          required: el.required,
          hidden: !!(el.offsetParent === null),
          ariaLabel: el.getAttribute("aria-label") || "",
          className: el.getAttribute("class") || "",
          labelText: labels.join(" | "),
          ancestorPath: getAncestorPath(el)
        };
      }),
      uploadErrorText: Array.from(document.querySelectorAll("*"))
        .map((el) => (el.textContent || "").trim())
        .find((t) => t.toLowerCase().includes("cannot read properties of undefined") && t.toLowerCase().includes("uploadfile")) || null
    };
  });

  console.log("\n=== BEFORE UPLOAD ===");
  console.log("Title:", before.title);
  console.log("Resume header found:", before.resumeHeader);
  console.log("Attach buttons:", before.attachButtons);
  console.log("File inputs:", JSON.stringify(summarizeFileInputs(before.fileInputs), null, 2));
  console.log("Upload error text:", before.uploadErrorText);

  const fileInput = formPage.locator("input[type='file']").first();
  const inputCount = await formPage.locator("input[type='file']").count();
  console.log("Detected input[type=file] count:", inputCount);

  if (inputCount > 0) {
    await fileInput.setInputFiles(resumePath);
    await formPage.waitForTimeout(1500);
  }

  const after = await formPage.evaluate(() => {
    const fileInput = document.querySelector("input[type='file']");
    return {
      inputValue: fileInput ? fileInput.getAttribute("value") : null,
      uploadErrorText: Array.from(document.querySelectorAll("*"))
        .map((el) => (el.textContent || "").trim())
        .find((t) => t.toLowerCase().includes("cannot read properties of undefined") && t.toLowerCase().includes("uploadfile")) || null,
      visibleFileName: Array.from(document.querySelectorAll("*"))
        .map((el) => (el.textContent || "").trim())
        .find((t) => t.toLowerCase().includes("my_resume.pdf") || t.toLowerCase().includes("resume.pdf")) || null,
      attachButtons: Array.from(document.querySelectorAll("button, [role='button']"))
        .map((el) => (el.textContent || "").trim())
        .filter((t) => t.length > 0)
        .slice(0, 50)
    };
  });

  console.log("\n=== AFTER setInputFiles ===");
  console.log(JSON.stringify(after, null, 2));

  await formPage.screenshot({ path: "./logs/screenshots/playwright-greenhouse-upload-probe.png", fullPage: true });
  console.log("Saved screenshot: logs/screenshots/playwright-greenhouse-upload-probe.png");
} finally {
  await browser.close();
}
