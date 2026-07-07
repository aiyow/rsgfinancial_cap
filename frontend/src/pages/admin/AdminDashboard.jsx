import { Link } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'

const pages = [
  { title: 'Users', description: 'Create accounts, update status, and remove incorrect users.', to: '/admin/users' },
  { title: 'Unit Directory', description: 'Search and filter unit, resident, size, floor, and occupancy records.', to: '/admin/units' },
  { title: 'Manage Units', description: 'Create condominium units and manage their details and occupancy.', to: '/admin/units/manage' },
  { title: 'Assignments', description: 'Connect Residents to units as owners or tenants.', to: '/admin/assignments' },
  { title: 'Forwarded SOAs', description: 'Review billing batches and statements forwarded by the Collector.', to: '/admin/soa' },
  { title: 'Payments', description: 'Review OCR payment proofs and verify Resident payments.', to: '/admin/payments' },
  { title: 'Audit Logs', description: 'Track admin, collector, and resident changes across the portal.', to: '/admin/audit-logs' },
]

export default function AdminDashboard() {
  return (
    <DashboardLayout title="Administration" description="Choose a management page from the sidebar or the cards below.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pages.map((page) => (
          <Link key={page.title} to={page.to} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300">
            <h2 className="text-lg font-black text-slate-950">{page.title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{page.description}</p>
            <p className="mt-5 text-sm font-bold text-indigo-600">Open {page.title} →</p>
          </Link>
        ))}
      </div>
    </DashboardLayout>
  )
}
