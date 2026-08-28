<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchEmployees } from '../api/employees'
import type { EmployeeCard } from '../api/employees'

/** 底座 id → 显示名映射（前端静态表；后续底座检测域完善后可换 API 驱动） */
const BASE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  qoder: 'Qoder',
  codebuddy: 'CodeBuddy',
}

function baseLabel(hostId: string): string {
  return BASE_LABELS[hostId] ?? hostId
}

/**
 * 我的员工页（L1 员工新建线 Task 17 + 2026-08-28 UX 迭代）：
 * - page-head：h1「我的员工」+ 副标 + 工具行「＋新建员工」按钮 → /employees/new
 * - 卡片 grid：每张卡 = 头像 emoji + 岗位名 + kind tag + version + id + brief 两行截断 + 底座徽章行
 * - 只显示已安装员工（hosts.length > 0）；未安装员工不在此页显示
 * - 空态引导卡：无已安装员工时显示「＋新建员工」
 * - 数据：onMounted 调 fetchEmployees()；失败归一空列表 → 空态
 *
 * 2026-08-28 裁决：一员工一卡（非一底座一卡），卡上带底座徽章行（该员工全部 deployments 的 host display）。
 */
const router = useRouter()
const items = ref<EmployeeCard[]>([])
const loading = ref(true)

/** 只显示已安装员工（hosts.length > 0） */
const installedItems = computed(() => items.value.filter((emp) => emp.hosts && emp.hosts.length > 0))

onMounted(async () => {
  const result = await fetchEmployees()
  items.value = result.items
  loading.value = false
})

function goCreate(): void {
  router.push('/employees/new')
}

/** kind tag 类（flow-owner 蓝 / callee 紫 / 其余灰） */
function kindTagClass(kind: string): string {
  if (kind === 'flow-owner') return 'tag tag-blue'
  if (kind === 'callee') return 'tag tag-violet'
  return 'tag tag-gray'
}

/** 头像兜底：avatar 非空取 avatar，否则取 display 首字 */
function avatarChar(card: EmployeeCard): string {
  if (card.avatar && card.avatar.trim() !== '') return card.avatar
  return card.display.charAt(0) || '?'
}
</script>

<template>
  <section class="employees-view">
    <header class="page-head">
      <div>
        <h1>我的员工</h1>
        <p class="sub">已安装到底座的数字员工</p>
      </div>
      <button class="btn btn-primary new-emp-btn" @click="goCreate">＋ 新建员工</button>
    </header>

    <div v-if="loading" class="loading">加载中…</div>

    <div v-else-if="installedItems.length === 0" class="emp-grid">
      <div
        class="empty-card"
        role="button"
        tabindex="0"
        @click="goCreate"
        @keydown.enter.prevent="goCreate"
        @keydown.space.prevent="goCreate"
      >
        <div class="empty-avatar">＋</div>
        <div class="empty-title">新建员工</div>
        <div class="empty-desc">从模板快速创建你的数字员工</div>
      </div>
    </div>

    <div v-else class="emp-grid">
      <div v-for="emp in installedItems" :key="emp.id" class="emp-card">
        <div class="emp-head">
          <div class="avatar">{{ avatarChar(emp) }}</div>
          <div>
            <div class="emp-name">{{ emp.display }}</div>
            <span :class="kindTagClass(emp.kind)">{{ emp.kind }}</span>
          </div>
        </div>
        <div class="emp-desc">{{ emp.brief }}</div>
        <div class="emp-foot">
          <span class="muted">{{ emp.id }}</span>
          <span class="muted">v{{ emp.version }}</span>
        </div>
        <!-- 底座徽章行（2026-08-28：一员工一卡，卡上标注安装到了几个底座） -->
        <div class="host-badges" data-role="host-badges">
          <span v-for="host in emp.hosts" :key="host" class="host-badge">{{ baseLabel(host) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 原型 .page-head：标题区 + 下间距 18px */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 18px;
  gap: 16px;
  flex-wrap: wrap;
}

h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin: 0;
}

.sub {
  color: var(--g500);
  margin-top: 5px;
  font-size: 13px;
}

/* 原型 .btn / .btn-primary */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: 0.15s;
  white-space: nowrap;
}

.btn-primary {
  background: var(--blue-600);
  color: #fff;
}

.btn-primary:hover {
  background: var(--blue-700);
}

/* 卡片 grid 沿 .tpl-grid 形态 */
.emp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 14px;
}

.emp-card {
  background: #fff;
  border: 1.5px solid var(--g200);
  border-radius: 14px;
  padding: 18px 16px;
  transition: 0.15s;
}

.emp-card:hover {
  border-color: var(--blue-400);
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.1);
  transform: translateY(-2px);
}

.emp-head {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 10px;
}

/* 头像字圆（与 TplGrid 同形态） */
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 15px;
  color: #fff;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--blue-600), var(--blue-400));
}

.emp-name {
  font-weight: 600;
  font-size: 14.5px;
}

/* 原型 .tag 通用 + 蓝/紫/灰变体 */
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

.tag-blue {
  background: var(--blue-100);
  color: var(--blue-800);
}

.tag-violet {
  background: var(--violet-bg);
  color: var(--violet);
}

.tag-gray {
  background: var(--g100);
  color: var(--g600);
}

.emp-desc {
  font-size: 12px;
  color: var(--g500);
  line-height: 1.55;
  min-height: 38px;
  /* brief 两行截断（webkit-line-clamp） */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.emp-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}

.muted {
  color: var(--g500);
  font-size: 12px;
}

/* 底座徽章行（2026-08-28：demo 工牌卡风格） */
.host-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--g100);
}

.host-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--green-bg);
  color: var(--green);
}

/* 空态引导卡：虚线边 + 居中布局，点击跳 /employees/new */
.empty-card {
  background: #fff;
  border: 1.5px dashed var(--g300);
  border-radius: 14px;
  padding: 28px 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: 0.15s;
  text-align: center;
}

.empty-card:hover {
  border-color: var(--blue-400);
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.1);
}

.empty-card:focus-visible {
  outline: 2px solid var(--blue-500);
  outline-offset: 2px;
}

.empty-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--g500);
  background: var(--g100);
}

.empty-title {
  font-weight: 600;
  font-size: 14.5px;
  color: var(--g700);
}

.empty-desc {
  font-size: 12px;
  color: var(--g500);
}

.loading {
  color: var(--g500);
  font-size: 13px;
  padding: 40px 0;
  text-align: center;
}
</style>
