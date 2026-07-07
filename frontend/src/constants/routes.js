const dashboardPaths = {
  ADMIN: '/admin',
  COLLECTOR: '/collector',
  RESIDENT: '/resident',
}

export function dashboardPathFor(role) {
  return dashboardPaths[role] || '/login'
}
