<script setup lang="ts">
import { computed } from 'vue'

import { navigationForPermissions } from '../navigation'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const items = computed(() => navigationForPermissions(session.permissions))
const roleNames = computed(() => session.me?.roles.map((role) => role.role_code).join(' · ') ?? '')
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand inverse" to="/"><span class="brand-mark light">A</span><span>Atlas Control</span></RouterLink>
      <nav>
        <RouterLink v-for="item in items" :key="item.path" :to="item.path">{{ item.label }}</RouterLink>
      </nav>
      <div class="environment"><span class="status-dot"></span>真实服务已连接</div>
    </aside>
    <section class="app-main">
      <header class="topbar">
        <div><strong>{{ session.me?.principal.display_name }}</strong><small>{{ roleNames }}</small></div>
        <button class="button" type="button" @click="session.logout">退出</button>
      </header>
      <main class="workspace"><RouterView /></main>
    </section>
  </div>
</template>
