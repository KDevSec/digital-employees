<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { fetchPlatformConfig, savePlatformConfig } from '../../api/platform-config'

/**
 * 平台连接配置卡（I0-5 T8，设计 D-16：F-03 增量，挂接入页 hero 区——未登录即可配，
 * 登录前就要知道平台在哪）。
 * - 显示当前平台地址 + 行内编辑（input + 保存）+ 校验失败提示 + 保存成功反馈；
 * - 前端校验只拦 scheme（空/非 http(s) 开头快速反馈，不发请求）；完整 URL 合法性由
 *   服务端 zod 兜底（400 透传 error.message 展示——形状沿 PlatformError，见 api 层注释）；
 * - GET 失败（服务不可达）不白屏：当前值未知但输入仍可编辑保存（D-18：配置的即时效果 =
 *   保存/持久化，非登录链路切换）。
 * T7 蓝系视觉（沿 AccessView 卡语言）：.card 白底 + section-title 蓝竖条标题 +
 * btn-primary 小号保存按钮 + tag-green 成功反馈 + red-bg 错误提示条。
 */

/** 前端 scheme 拦截提示（与服务端 refine 消息同语义；大小写不敏感，new URL 对 scheme 小写规范化） */
const SCHEME_HINT = '平台地址必须以 http:// 或 https:// 开头'

/** 当前生效的平台地址（GET 成功或保存成功后更新；null = 未知——加载失败/未返回） */
const current = ref<string | null>(null)
/** 挂载拉取失败（服务不可达/形状不对）→ 显示提示但不锁输入 */
const loadFailed = ref(false)
/** 编辑草稿（挂载成功时预填当前值） */
const draft = ref('')
const saving = ref(false)
/** 保存成功反馈文案（tag-green；取自 api 层结果，文案单源） */
const savedMessage = ref('')
/** 校验/服务端错误消息（red-bg 提示条） */
const error = ref('')

onMounted(async () => {
  const config = await fetchPlatformConfig()
  if (config) {
    current.value = config.baseUrl
    draft.value = config.baseUrl
  } else {
    loadFailed.value = true
  }
})

/** scheme 校验：非空且 http(s) 开头才放行（完整 URL 合法性交服务端 zod 兜底） */
function schemeValid(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

async function save(): Promise<void> {
  const value = draft.value.trim()
  if (!schemeValid(value)) {
    error.value = SCHEME_HINT
    savedMessage.value = ''
    return
  }
  error.value = ''
  savedMessage.value = ''
  saving.value = true
  const result = await savePlatformConfig(value)
  saving.value = false
  if (result.ok) {
    current.value = value
    draft.value = value
    savedMessage.value = result.message
  } else {
    error.value = result.message
  }
}
</script>

<template>
  <section class="card platform-card">
    <h2>平台连接</h2>
    <p class="desc">管控平台地址，前期服务器切换时可在此修改</p>
    <div class="row"><span>当前地址</span><strong>{{ current ?? '未知' }}</strong></div>
    <p v-if="loadFailed" class="load-hint">无法读取当前配置（服务不可达），仍可编辑保存</p>
    <div class="editor">
      <input v-model="draft" type="text" placeholder="http://127.0.0.1:18000" aria-label="平台地址" />
      <button type="button" class="btn btn-primary btn-sm" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <span v-if="savedMessage" class="tag tag-green">{{ savedMessage }}</span>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
/* T7 蓝系卡语言：白底 / g200 边框 / 14px 圆角 / 浅蓝墨投影（与 AccessView 各卡同款） */
.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

/* section-title 语言（蓝竖条 + 15px 600，同 AccessView 卡标题） */
h2 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

h2::before {
  content: '';
  width: 4px;
  height: 15px;
  border-radius: 2px;
  background: var(--blue-500);
}

.desc {
  color: var(--g500);
  font-size: 12.5px;
  margin-bottom: 10px;
}

/* 行 .row 沿用（token 化：span g500、行分隔 g100） */
.row {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--g100);
  align-items: center;
}

.row > span {
  color: var(--g500);
}

.row strong {
  font-size: 12.5px;
  word-break: break-all;
}

.load-hint {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--g500);
}

/* 行内编辑：input + 保存按钮 + 成功反馈（同一行，窄卡下可换行） */
.editor {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.editor input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--g300);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  color: var(--ink);
  background: #fff;
}

.editor input:focus {
  outline: none;
  border-color: var(--blue-400);
}

/* 原型 .btn .btn-primary .btn-sm 语言（同 TopBar/AccessActions 子集） */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: 0.15s;
  font-weight: 500;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-primary {
  background: var(--blue-600);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--blue-700);
}

.btn-sm {
  padding: 5px 11px;
  font-size: 12px;
  border-radius: 7px;
}

/* 原型 .tag .tag-green 语言（pill 成功反馈） */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.tag-green {
  background: var(--green-bg);
  color: var(--green);
}

/* 错误提示条：red-bg 底 red 字（同 TopBar 告警条形态，尺寸缩小贴合卡内） */
.error {
  background: var(--red-bg);
  color: var(--red);
  padding: 7px 12px;
  font-size: 12.5px;
  border-radius: 8px;
  margin-top: 12px;
}

/* hero 区右侧挂载位：限宽防挤压左侧标题区（AccessView .hero flex space-between） */
.platform-card {
  width: 360px;
  max-width: 100%;
  flex-shrink: 0;
}
</style>
