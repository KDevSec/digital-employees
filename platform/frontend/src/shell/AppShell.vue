<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { navigationForPermissions } from '../navigation'
import { fetchPlatformVersion } from '../version'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()
const tree = computed(() => navigationForPermissions(session.permissions, t))
const platformVersion = ref<string | null>(null)
onMounted(async () => {
  platformVersion.value = await fetchPlatformVersion()
})

const roleNames = computed(() => {
  const roles = session.me?.roles ?? []
  return roles
    .map((role) => {
      const label = t(`app.roles.${role.role_code}`, role.role_code)
      const orgs = role.managed_orgs ?? []
      if (orgs.length === 0) return label
      const orgNames = orgs.map((org) => org.name).join('、')
      return `${label}（${orgNames}）`
    })
    .join(' · ')
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand inverse" to="/"><span class="brand-mark light">数</span><span>{{ t('app.brand') }}</span></RouterLink>
      <nav>
        <RouterLink v-for="item in tree.standalone" :key="item.path" :to="item.path">{{ item.label }}</RouterLink>
        <div v-for="group in tree.groups" :key="group.label" class="nav-group">
          <p class="nav-group-label">{{ group.label }}</p>
          <RouterLink v-for="item in group.items" :key="item.path" :to="item.path">{{ item.label }}</RouterLink>
        </div>
      </nav>
      <div class="sidebar-foot">
        <div v-if="platformVersion" class="platform-version">v{{ platformVersion }}</div>
      </div>
    </aside>
    <section class="app-main">
      <header class="topbar">
        <div><strong>{{ session.me?.principal.display_name }}</strong><small>{{ roleNames }}</small></div>
        <button class="button" type="button" @click="session.logout">{{ t('app.logout') }}</button>
      </header>
      <main class="workspace"><RouterView /></main>
    </section>
  </div>
</template>

<style scoped>
.nav-group { margin-top: 14px; }
.nav-group-label { margin: 0 0 4px; padding: 0 12px; font-size: 10px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: rgba(255, 255, 255, .5); }
.nav-group :deep(a) { display: block; }
</style>

<style scoped>
.sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
.platform-version { font-size: 11px; color: rgba(255, 255, 255, .45); padding: 0 12px; }
</style>
