import { Link } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'

const pages = [
  { title: 'Monthly billing', description: 'Create a billing period and import the Collector spreadsheet.', to: '/collector/billing' },
  { title: 'Bills and SOAs', description: 'Review generated bills and open printable statements of account.', to: '/collector/bills' },
  { title: 'Units', description: 'View the condominium unit directory and resident assignments.', to: '/collector/units' },
  { title: 'Verified payments', description: 'View payment records approved by Admin.', to: '/collector/payments' },
]

export default function CollectorDashboard() {
  return (
    <DashboardLayout title="Collector dashboard" description="Prepare monthly billing and review generated statements.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {pages.map((page) => (
          <Link key={page.title} to={page.to} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300">
            <h2 className="text-lg font-black">{page.title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{page.description}</p>
            <p className="mt-5 text-sm font-bold text-indigo-600">Open {page.title} →</p>
          </Link>
        ))}
      </div>
    </DashboardLayout>
  )
}
