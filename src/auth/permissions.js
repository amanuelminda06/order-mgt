/** RBAC matrix for the three remaining roles. Used by all protected routes. */
const ROLES = ['admin', 'cashier', 'waiter'];

const PERMISSIONS = {
  'menu.write': ['admin'],
  'category.write': ['admin'],
  'staff.write': ['admin'],
  'settings.write': ['admin'],
  'analytics.read': ['admin'],
  'audit.read': ['admin'],
  'table.write': ['admin'],
  'upload.write': ['admin'],
  'ordering.toggle': ['admin', 'cashier'],
  'order.read': ['admin', 'cashier', 'waiter'],
  'order.cancel': ['admin', 'cashier', 'waiter'],
};

function can(role, action) {
  return (PERMISSIONS[action] || []).includes(role);
}

module.exports = { ROLES, PERMISSIONS, can };
