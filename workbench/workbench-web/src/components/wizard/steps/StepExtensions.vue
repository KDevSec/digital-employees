<script setup lang="ts">
/**
 * Step 6 · 其他（五轻 chip 折叠区——对齐 1.0 demo `feat/demo-4stage-flow` /specs/new §3.3）
 *
 * 五轻类：Tools / Hook / Command / 知识库 / 其他。
 * - Tools / Hook / 知识库：`<details>` 折叠区 + chip 多选（当前为展示占位，demo 同源候选清单，
 *   不写入 manifest——schema 无对应字段，仅影响右侧预览目录树显隐，预留 V0.2 包结构承接）。
 * - 其他：自由备注 textarea（占位「其他扩展说明（可空）」）。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">🧩</span> 扩展 —— 员工还需要什么</div>

    <details class="ext-sec" data-role="ext-tools">
      <summary>Tools</summary>
      <div class="ext-chips">
        <span class="ext-chip">代码执行沙箱</span>
        <span class="ext-chip">网页检索</span>
        <span class="ext-chip">文件读写</span>
        <span class="ext-chip">图表渲染</span>
      </div>
      <p class="ext-hint">候选清单与 demo 同源；勾选暂存草稿，生成时写入员工包 tools/ 目录（V0.2 开放）。</p>
    </details>

    <details class="ext-sec" data-role="ext-hooks">
      <summary>Hook</summary>
      <div class="ext-chips">
        <span class="ext-chip">提交前 lint 检查</span>
        <span class="ext-chip">危险命令拦截</span>
        <span class="ext-chip">会话结束自动归档</span>
        <span class="ext-chip">产物落盘校验</span>
      </div>
      <p class="ext-hint">正向功能 hook 属 V0.2 扩展项；V0.1 红线编译规则在「约束Hook」步配置。</p>
    </details>

    <details class="ext-sec" data-role="ext-knowledge">
      <summary>知识库</summary>
      <div class="ext-chips">
        <span class="ext-chip">团队 Wiki</span>
        <span class="ext-chip">产品手册</span>
        <span class="ext-chip">历史项目复盘库</span>
        <span class="ext-chip">行业规范文集</span>
      </div>
      <p class="ext-hint">知识库文档上传与向量检索 V0.2 开放；当前版本员工知识由 skills 自带的 references 段承载。</p>
    </details>

    <details class="ext-sec" data-role="ext-misc">
      <summary>其他</summary>
      <div class="form-row" style="margin-top:12px;margin-bottom:0">
        <textarea class="textarea misc-input" placeholder="其他扩展说明（可空）"></textarea>
      </div>
    </details>
  </div>
</template>

<style scoped>
.cat-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px dashed var(--g200);
}

.cat-section-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.cat-icon {
  font-size: 16px;
}

/* demo .ext-sec：五轻折叠分区 */
.ext-sec {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 12px 18px;
  margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.ext-sec summary {
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: var(--ink);
}

.ext-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.ext-chip {
  padding: 4px 13px;
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  background: var(--g100);
  color: var(--g600);
  border: 1px solid transparent;
  transition: 0.15s;
}

.ext-chip:hover {
  color: var(--blue-700);
}

.ext-hint {
  font-size: 12px;
  color: var(--g400);
  margin-top: 10px;
  line-height: 1.55;
}

.textarea {
  width: 100%;
  border: 1px solid var(--g300);
  border-radius: 9px;
  padding: 9px 13px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  background: #fff;
  transition: 0.15s;
}

.textarea:focus {
  border-color: var(--blue-500);
  box-shadow: 0 0 0 3px var(--blue-100);
}

.misc-input {
  min-height: 70px;
  resize: vertical;
  line-height: 1.55;
}
</style>
