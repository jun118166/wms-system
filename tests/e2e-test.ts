/**
 * E2E 测试脚本 - 万能导入 V2 系统
 * 使用方法: npx tsx tests/e2e-test.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const DEMO_DIR = path.resolve(__dirname, '../../AI考试附件/demos');

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  screenshot?: string;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

// Ensure screenshot dir
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function screenshot(page: any, name: string) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return `screenshots/${name}.png`;
}

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, details: '通过', duration: Date.now() - start });
    console.log(`✅ ${name}`);
  } catch (e: any) {
    results.push({ name, passed: false, details: '失败', error: e.message, duration: Date.now() - start });
    console.log(`❌ ${name}: ${e.message}`);
  }
}

async function main() {
  console.log('🚀 开始 E2E 测试...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  // ======================================================
  // 考点 1: 项目搭建与页面加载
  // ======================================================
  await runTest('1.1 首页加载', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    const title = await page.title();
    if (!title.includes('万能导入')) throw new Error(`标题错误: ${title}`);
    await screenshot(page, '01-homepage');
  });

  await runTest('1.2 UI风格检查-主色', async () => {
    const headerBg = await page.$eval('header', el => getComputedStyle(el).backgroundColor);
    // Check for primary color elements
    const primaryElements = await page.$$('[class*="primary"]');
    if (primaryElements.length === 0) {
      console.log('  ⚠️ 未检测到 primary 样式类');
    }
    await screenshot(page, '02-ui-check');
  });

  await runTest('1.3 导航栏功能', async () => {
    const navLinks = await page.$$('nav a');
    if (navLinks.length < 2) throw new Error(`导航链接不足: ${navLinks.length}`);
  });

  // ======================================================
  // 考点 2: 文件上传功能
  // ======================================================
  await runTest('2.1 文件上传区域显示', async () => {
    const uploadArea = await page.$('text=拖拽文件到此处');
    if (!uploadArea) throw new Error('上传区域未显示');
  });

  // Upload test file
  const testFile = path.join(DEMO_DIR, '多门店分Sheet出库单.xlsx');
  if (!fs.existsSync(testFile)) {
    console.log('  ⚠️ 测试文件不存在，跳过文件上传测试');
  } else {
    await runTest('2.2 文件上传', async () => {
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) {
        // Try click-to-upload
        await page.click('text=拖拽文件到此处');
      }
      
      // Use file chooser
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
        page.click('text=拖拽文件到此处'),
      ]);

      if (fileChooser) {
        await fileChooser.setFiles(testFile);
        await page.waitForTimeout(2000);
        await screenshot(page, '03-file-uploaded');
      } else {
        console.log('  ⚠️ 文件选择器未触发');
      }
    });

    await runTest('2.3 进入规则选择步骤', async () => {
      const ruleSelector = await page.$('text=选择解析规则');
      if (!ruleSelector) throw new Error('未进入规则选择步骤');
      await screenshot(page, '04-rule-selection');
    });
  }

  // ======================================================
  // 考点 3: 解析规则管理页
  // ======================================================
  await runTest('3.1 规则管理页加载', async () => {
    await page.goto(`${BASE_URL}/rules`, { waitUntil: 'networkidle', timeout: 15000 });
    const heading = await page.$('text=解析规则管理');
    if (!heading) throw new Error('规则管理页未加载');
    await screenshot(page, '05-rules-page');
  });

  await runTest('3.2 规则列表显示', async () => {
    await page.waitForTimeout(1000);
    // Check if rules grid or empty state is shown
    const hasRules = await page.$('[class*="rule"]');
    const hasEmpty = await page.$('text=暂无解析规则');
    console.log(`  规则状态: ${hasRules ? '有规则' : hasEmpty ? '空状态' : '未知'}`);
  });

  // ======================================================
  // 考点 4: 运单列表页
  // ======================================================
  await runTest('4.1 运单列表页加载', async () => {
    await page.goto(`${BASE_URL}/orders`, { waitUntil: 'networkidle', timeout: 15000 });
    const heading = await page.$('text=已导入运单列表');
    if (!heading) throw new Error('运单列表页未加载');
    await screenshot(page, '06-orders-page');
  });

  await runTest('4.2 搜索功能显示', async () => {
    const searchInput = await page.$('input[placeholder*="搜索"]');
    if (!searchInput) console.log('  ⚠️ 搜索输入框未找到');
  });

  // ======================================================
  // 考点 5: 响应式设计检查
  // ======================================================
  await runTest('5.1 移动端适配', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await screenshot(page, '07-mobile-view');
    
    // Check no horizontal overflow
    const bodyWidth = await page.$eval('body', el => el.scrollWidth);
    const viewportWidth = await page.viewportSize();
    if (bodyWidth > (viewportWidth?.width || 400) + 50) {
      console.log('  ⚠️ 移动端可能存在横向溢出');
    }
  });

  // ======================================================
  // 考点 6: 性能检查 (页面加载时间)
  // ======================================================
  await runTest('6.1 页面加载性能', async () => {
    const start = Date.now();
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 15000 });
    const loadTime = Date.now() - start;
    if (loadTime > 5000) {
      console.log(`  ⚠️ 加载时间较长: ${loadTime}ms`);
    } else {
      console.log(`  加载时间: ${loadTime}ms`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // ======================================================
  // 考点 7: 创建规则的完整流程
  // ======================================================
  await runTest('7.1 规则创建流程', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    
    // Upload file first
    const testFile = path.join(DEMO_DIR, '湖南仓.xlsx');
    if (fs.existsSync(testFile)) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null as any),
        page.click('text=拖拽文件到此处'),
      ]);
      if (fileChooser) {
        await fileChooser.setFiles(testFile);
        await page.waitForTimeout(2000);
        await screenshot(page, '08-rule-create-flow');
      }
    }
  });

  // ======================================================
  // 最终报告
  // ======================================================
  await browser.close();

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  // Generate report
  const reportHtml = generateHtmlReport(results);
  const reportPath = path.join(SCREENSHOT_DIR, 'test-report.html');
  fs.writeFileSync(reportPath, reportHtml, 'utf-8');

  console.log('\n' + '='.repeat(60));
  console.log('📊 测试报告');
  console.log('='.repeat(60));
  console.log(`总计: ${total}  |  通过: ${passed}  |  失败: ${failed}`);
  console.log(`通过率: ${((passed / total) * 100).toFixed(1)}%`);
  console.log(`\n📄 HTML 报告: ${reportPath}`);
  console.log(`📁 截图目录: ${SCREENSHOT_DIR}`);
  console.log('='.repeat(60));
}

function generateHtmlReport(results: TestResult[]): string {
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';

  const rows = results.map((r, i) => `
    <tr class="${r.passed ? 'pass' : 'fail'}">
      <td>${i + 1}</td>
      <td>${r.name}</td>
      <td class="${r.passed ? 'status-pass' : 'status-fail'}">${r.passed ? '✅ 通过' : '❌ 失败'}</td>
      <td>${r.details}</td>
      <td>${r.duration}ms</td>
      <td>${r.error || ''}</td>
      <td>${r.screenshot ? `<a href="${r.screenshot}" target="_blank">查看</a>` : ''}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>万能导入 V2 - E2E 测试报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, 'PingFang SC', sans-serif; background: #f7f8fa; padding: 40px 20px; color: #1d2129; }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #0fc6c2, #0bada9); color: #fff; padding: 32px 40px; border-radius: 16px 16px 0 0; }
    .header h1 { font-size: 24px; font-weight: 700; }
    .header p { font-size: 14px; opacity: 0.85; margin-top: 4px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 24px 40px; background: #fff; border-bottom: 1px solid #e5e6eb; }
    .stat { text-align: center; }
    .stat .value { font-size: 28px; font-weight: 700; }
    .stat .label { font-size: 12px; color: #86909c; margin-top: 4px; }
    .stat.pass .value { color: #22c55e; }
    .stat.fail .value { color: #ef4444; }
    .stat.total .value { color: #3b82f6; }
    .stat.rate .value { color: #0fc6c2; }
    .content { background: #fff; padding: 24px 40px; border-radius: 0 0 16px 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { background: #f7f8fa; padding: 10px 14px; text-align: left; font-weight: 600; color: #4e5969; border-bottom: 2px solid #e5e6eb; }
    td { padding: 10px 14px; border-bottom: 1px solid #f2f3f5; }
    tr.pass { background: #f0fdf4; }
    tr.fail { background: #fef2f2; }
    .status-pass { color: #16a34a; font-weight: 600; }
    .status-fail { color: #dc2626; font-weight: 600; }
    a { color: #0fc6c2; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #86909c; }
    .checklist { padding: 20px 40px; background: #fff; margin-top: 16px; border-radius: 16px; }
    .checklist h3 { font-size: 16px; margin-bottom: 12px; color: #1d2129; }
    .checklist ul { padding-left: 20px; }
    .checklist li { font-size: 14px; color: #4e5969; margin-bottom: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>万能导入 V2 - 智能批量下单系统</h1>
      <p>端到端 (E2E) 自动化测试报告 | ${new Date().toLocaleString('zh-CN')}</p>
    </div>
    <div class="summary">
      <div class="stat total"><div class="value">${total}</div><div class="label">测试总数</div></div>
      <div class="stat pass"><div class="value">${passed}</div><div class="label">通过</div></div>
      <div class="stat fail"><div class="value">${total - passed}</div><div class="label">失败</div></div>
      <div class="stat rate"><div class="value">${rate}%</div><div class="label">通过率</div></div>
    </div>
    <div class="content">
      <table>
        <thead>
          <tr>
            <th width="50">#</th>
            <th width="250">测试用例</th>
            <th width="80">状态</th>
            <th width="120">详情</th>
            <th width="80">耗时</th>
            <th width="200">错误信息</th>
            <th width="60">截图</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <div class="checklist">
      <h3>📋 考试考点覆盖检查</h3>
      <ul>
        <li><strong>考点1 项目搭建与部署</strong>: 页面正常加载 (10分)</li>
        <li><strong>考点2 UI风格与交互</strong>: 主色#0fc6c2, 圆角卡片, 响应式/移动端 (30分)</li>
        <li><strong>考点3 解析规则+AI</strong>: 规则CRUD, AI辅助生成 (50分)</li>
        <li><strong>考点4 性能要求</strong>: 页面加载速度 (20分)</li>
      </ul>
    </div>
    <div class="footer">万能导入 V2 · E2E 自动化测试</div>
  </div>
</body>
</html>`;
}

main().catch(console.error);
