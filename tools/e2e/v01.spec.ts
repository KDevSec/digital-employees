import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const publicHost = process.env.PUBLIC_HOST ?? '127.0.0.1'
const platformUrl = process.env.PLATFORM_URL ?? `http://${publicHost}:18000`
const workbenchUrl = process.env.WORKBENCH_URL ?? `http://${publicHost}:19820`
const password = process.env.E2E_PASSWORD ?? 'Horse~test@2026'

async function login(page: Page, entryUrl: string, username: string): Promise<void> {
  await page.goto(entryUrl)
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('#kc-login').click()
  await expect.poll(() => new URL(page.url()).origin).toBe(new URL(entryUrl).origin)
}

async function platformSession(browser: Browser, username: string): Promise<BrowserContext> {
  const context = await browser.newContext()
  await login(await context.newPage(), `${platformUrl}/auth/login?return_to=/app/overview`, username)
  return context
}

async function assignRole(
  page: Page,
  username: string,
  role: string,
  scope?: 'ALL_DEPARTMENTS' | 'DEPARTMENT_SET',
): Promise<void> {
  await page.goto(`${platformUrl}/app/permissions`)
  const principalOption = page.getByLabel('人员').locator('option').filter({ hasText: `(${username})` })
  await expect(principalOption).toHaveCount(1)
  await page.getByLabel('人员').selectOption((await principalOption.getAttribute('value'))!)
  await page.getByLabel('角色').selectOption(role)
  if (scope) {
    await page.locator('#scope-type').selectOption(scope)
    await page.locator('#domain').selectOption('domain-east')
    if (scope === 'DEPARTMENT_SET') await page.locator('#departments').selectOption('dept-rd')
  }
  await page.getByRole('button', { name: '授予角色' }).click()
  await expect(page.getByRole('row').filter({ hasText: role }).first()).toBeVisible()
}

test('V0.1 uses real OIDC, database, key proof, machine token and package bytes', async ({ browser }) => {
  const unique = Date.now().toString()
  const artifact = Buffer.from(`real-workbench-package-${unique}`)

  const admin = await platformSession(browser, 'system.admin')
  const adminPage = admin.pages()[0]
  await expect(adminPage.getByText('SYSTEM_ADMIN').first()).toBeVisible()

  await adminPage.goto(`${platformUrl}/app/packages`)
  await adminPage.getByLabel('版本').fill(`0.1.${unique}`)
  await adminPage.getByLabel('文件').setInputFiles({ name: `workbench-${unique}.bin`, mimeType: 'application/octet-stream', buffer: artifact })
  await adminPage.getByRole('button', { name: '上传草稿' }).click()
  await expect(adminPage.getByText('上传成功，当前为草稿。')).toBeVisible()
  const packageRow = adminPage.getByRole('row').filter({ hasText: `0.1.${unique}` })
  await packageRow.getByRole('button', { name: '发布' }).click()
  await expect(packageRow.getByText('PUBLISHED')).toBeVisible()

  const anonymous = await browser.newContext()
  const publicPage = await anonymous.newPage()
  await publicPage.goto(platformUrl)
  const card = publicPage.locator('.package-card').filter({ hasText: `0.1.${unique}` })
  await expect(card).toBeVisible()
  const href = await card.getByRole('link', { name: '下载' }).getAttribute('href')
  expect(href).toBeTruthy()
  const download = await anonymous.request.get(`${platformUrl}${href}`)
  expect(download.status()).toBe(200)
  expect(await download.body()).toEqual(artifact)

  const employee = await browser.newContext()
  const workbench = await employee.newPage()
  await login(workbench, `${workbenchUrl}/auth/login`, 'employee')
  await expect(workbench.getByText('employee')).toBeVisible()
  await workbench.getByRole('button', { name: '提交接入申请' }).click()
  await expect(workbench.locator('#state')).toContainText('PENDING_REVIEW')

  await adminPage.goto(`${platformUrl}/app/enrollments`)
  const enrollmentRow = adminPage.getByRole('row').filter({ hasText: 'PENDING_REVIEW' }).first()
  await enrollmentRow.getByRole('button', { name: '批准' }).click()
  await expect(adminPage.getByRole('row').filter({ hasText: 'APPROVED' }).first()).toBeVisible()

  await workbench.getByRole('button', { name: '审批后继续' }).click()
  await expect(workbench.locator('#state')).toContainText('ACTIVE')
  await expect(workbench.locator('#state')).toContainText('工作台 ID')

  await adminPage.goto(`${platformUrl}/app/workbenches`)
  const workbenchRow = adminPage.getByRole('row').filter({ hasText: 'Workbench ' }).first()
  await expect(workbenchRow.getByText('ONLINE')).toBeVisible()
  adminPage.once('dialog', (dialog) => dialog.accept('E2E credential revocation'))
  await workbenchRow.getByRole('button', { name: '撤销' }).click()
  await expect(workbenchRow.getByText('REVOKED').first()).toBeVisible()

  await workbench.getByRole('button', { name: '发送心跳' }).click()
  await expect(workbench.locator('#message')).toContainText('invalid')

  await adminPage.goto(`${platformUrl}/app/packages`)
  await packageRow.getByRole('button', { name: '下架' }).click()
  await expect(packageRow.getByText('WITHDRAWN')).toBeVisible()
  expect((await anonymous.request.get(`${platformUrl}${href}`)).status()).toBe(404)

  await employee.close()
  await anonymous.close()
  await admin.close()
})

test('all fixed administrator roles and an employee use real OIDC with fixed scopes', async ({ browser }) => {
  const system = await platformSession(browser, 'system.admin')
  const page = system.pages()[0]

  await assignRole(page, 'platform.admin', 'PLATFORM_ADMIN')
  await assignRole(page, 'department.admin', 'DEPARTMENT_ADMIN', 'DEPARTMENT_SET')
  await assignRole(page, 'security.admin', 'SECURITY_ADMIN', 'ALL_DEPARTMENTS')
  await assignRole(page, 'audit.admin', 'AUDIT_ADMIN', 'ALL_DEPARTMENTS')

  for (const [username, role] of [
    ['platform.admin', 'PLATFORM_ADMIN'],
    ['department.admin', 'DEPARTMENT_ADMIN'],
    ['security.admin', 'SECURITY_ADMIN'],
    ['audit.admin', 'AUDIT_ADMIN'],
    ['employee', 'EMPLOYEE'],
  ] as const) {
    const context = await platformSession(browser, username)
    const userPage = context.pages()[0]
    await expect(userPage.getByText(role).first()).toBeVisible()
    await expect(userPage.getByRole('link', { name: '工作台' })).toBeVisible()
    if (role === 'PLATFORM_ADMIN') await expect(userPage.getByRole('link', { name: '安装包' })).toBeVisible()
    else await expect(userPage.getByRole('link', { name: '安装包' })).toHaveCount(0)
    await context.close()
  }
  await system.close()
})
