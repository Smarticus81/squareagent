import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Mic, ShoppingCart, Package, BookOpen, ClipboardList, MapPin,
  Users, CreditCard, UserCog, BarChart3, ArrowLeft, MessageSquare,
  Volume2, Zap, ChevronRight,
} from "lucide-react";

/* ── Animation ─────────────────────────────────────────────── */
const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.6, ease },
  }),
};

/* ── Data ──────────────────────────────────────────────────── */

interface VoiceExample {
  phrase: string;
  description: string;
}

interface ToolInfo {
  name: string;
  description: string;
  examples: VoiceExample[];
}

interface DomainSection {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  tools: ToolInfo[];
}

const domains: DomainSection[] = [
  {
    title: "Point of Sale",
    subtitle: "Build and manage orders in real time — items appear on the Square POS as you speak.",
    icon: <ShoppingCart className="w-5 h-5" />,
    color: "text-emerald-400",
    tools: [
      {
        name: "add_item",
        description: "Add an item to the current order by name. Supports quantities and fuzzy matching against your catalog.",
        examples: [
          { phrase: "Two Fosters and a Bud Light", description: "Adds 2× Fosters + 1× Bud Light" },
          { phrase: "Tab a Corona", description: "Adds 1× Corona to the order" },
          { phrase: "Another round of IPAs — make it three", description: "Adds 3× IPA" },
        ],
      },
      {
        name: "remove_item",
        description: "Remove an item from the current order. Specify quantity to remove just some.",
        examples: [
          { phrase: "Take off the Bud Light", description: "Removes Bud Light from order" },
          { phrase: "86 one of the Fosters", description: "Removes 1× Fosters" },
          { phrase: "Scratch the last item", description: "Removes the most recent item" },
        ],
      },
      {
        name: "get_order",
        description: "Read back the full current order with item names, quantities, and running total.",
        examples: [
          { phrase: "What's on the ticket?", description: "Lists current order items + total" },
          { phrase: "Read that back to me", description: "Same — full order summary" },
          { phrase: "What's the damage?", description: "Just the total" },
        ],
      },
      {
        name: "clear_order",
        description: "Wipe the entire current order and cancel any live Square order.",
        examples: [
          { phrase: "Clear the order", description: "Removes all items" },
          { phrase: "Start fresh", description: "Wipes order" },
          { phrase: "Never mind, kill it", description: "Cancels everything" },
        ],
      },
      {
        name: "submit_order",
        description: "Finalize and submit the order to Square. Confirms the total before completing.",
        examples: [
          { phrase: "Ring it up", description: "Submit + complete order" },
          { phrase: "Close it out", description: "Submit order" },
          { phrase: "That's it, send it through", description: "Confirms and submits" },
        ],
      },
      {
        name: "send_to_terminal",
        description: "Push the current order to the Square Terminal device for card payment.",
        examples: [
          { phrase: "Send it to the terminal", description: "Pushes to card reader" },
          { phrase: "They want to tap", description: "Sends to terminal for card" },
          { phrase: "Card payment", description: "Sends to terminal" },
        ],
      },
      {
        name: "search_menu",
        description: "Search your catalog for items matching a query. Great for menu questions.",
        examples: [
          { phrase: "What beers do you have?", description: "Searches catalog for 'beer'" },
          { phrase: "Anything on tap?", description: "Searches for draft/tap items" },
          { phrase: "Do we have anything gluten-free?", description: "Searches catalog" },
        ],
      },
    ],
  },
  {
    title: "Inventory Management",
    subtitle: "Track stock levels, receive shipments, and catch low-stock items before you run out.",
    icon: <Package className="w-5 h-5" />,
    color: "text-blue-400",
    tools: [
      {
        name: "check_inventory",
        description: "Check the current stock level of a specific item in real time from Square.",
        examples: [
          { phrase: "How many Bud Lights do we have?", description: "Returns current stock count" },
          { phrase: "Check the Modelo count", description: "Shows stock level" },
        ],
      },
      {
        name: "check_all_inventory",
        description: "Get stock levels for every item in your catalog at once.",
        examples: [
          { phrase: "Give me a full stock check", description: "Lists all items + counts" },
          { phrase: "What does inventory look like?", description: "Full catalog stock report" },
        ],
      },
      {
        name: "adjust_inventory",
        description: "Add or remove stock with a reason (received, used, damaged, waste, correction).",
        examples: [
          { phrase: "We got a case of Bud Light", description: "Adds 24 units (case = 24)" },
          { phrase: "We lost three Coronas — damaged", description: "Removes 3, reason: damaged" },
          { phrase: "Add 48 Fosters, new shipment", description: "Adds 48, reason: received" },
        ],
      },
      {
        name: "set_inventory",
        description: "Set the absolute stock count after a physical count. Overwrites the current value.",
        examples: [
          { phrase: "Set Bud Light to 36", description: "Sets stock to exactly 36" },
          { phrase: "We counted 12 IPAs", description: "Sets IPA stock to 12" },
        ],
      },
      {
        name: "transfer_inventory",
        description: "Transfer stock from the current location to another Square location.",
        examples: [
          { phrase: "Send 12 Bud Lights to the downtown location", description: "Transfers stock between locations" },
        ],
      },
      {
        name: "get_inventory_changes",
        description: "View recent inventory change history for an item — who changed what and when.",
        examples: [
          { phrase: "Show me the Bud Light history", description: "Lists recent stock changes" },
          { phrase: "What happened with the Corona inventory?", description: "Change log" },
        ],
      },
      {
        name: "low_stock_report",
        description: "Find all items below a stock threshold. Default threshold is 5 units.",
        examples: [
          { phrase: "What's running low?", description: "Items below 5 units" },
          { phrase: "Anything under 10?", description: "Items below 10 units" },
          { phrase: "Low stock report", description: "Default threshold check" },
        ],
      },
      {
        name: "get_item_details",
        description: "Get full details for an item — price, category, variation info, and current stock.",
        examples: [
          { phrase: "Tell me about the IPA", description: "Full item details" },
          { phrase: "What's the deal with Modelo?", description: "Price, category, stock" },
        ],
      },
    ],
  },
  {
    title: "Catalog Management",
    subtitle: "Create, update, and organize your Square catalog entirely by voice.",
    icon: <BookOpen className="w-5 h-5" />,
    color: "text-violet-400",
    tools: [
      {
        name: "create_item",
        description: "Create a new item in your Square catalog with a name, price, and optional category.",
        examples: [
          { phrase: "Add a new item: Mango Seltzer, eight bucks", description: "Creates Mango Seltzer at $8.00" },
          { phrase: "New menu item — Spicy Margarita, twelve fifty, cocktails", description: "Creates in Cocktails category" },
        ],
      },
      {
        name: "update_item",
        description: "Change an existing item's name or price in the catalog.",
        examples: [
          { phrase: "Change the IPA price to nine fifty", description: "Updates IPA → $9.50" },
          { phrase: "Rename Bud Light to Bud Light Lime", description: "Updates name" },
          { phrase: "Bump the Margarita up to fourteen", description: "Price → $14.00" },
        ],
      },
      {
        name: "delete_item",
        description: "Permanently remove an item from your Square catalog. Always asks for confirmation.",
        examples: [
          { phrase: "Remove Stale Lager from the menu", description: "Deletes from catalog" },
          { phrase: "Kill the seasonal special", description: "Deletes item (confirms first)" },
        ],
      },
      {
        name: "list_categories",
        description: "List all categories in your catalog (Beer, Cocktails, Wine, Food, etc.).",
        examples: [
          { phrase: "What categories do we have?", description: "Lists all categories" },
          { phrase: "Show me the menu sections", description: "Category list" },
        ],
      },
      {
        name: "create_category",
        description: "Create a new category to organize your menu.",
        examples: [
          { phrase: "Create a Seasonal Specials category", description: "New category created" },
          { phrase: "Add a category called 'Non-Alcoholic'", description: "New category" },
        ],
      },
      {
        name: "list_modifiers",
        description: "List modifier groups like sizes, add-ons, or toppings configured in Square.",
        examples: [
          { phrase: "What modifiers do we have?", description: "Lists modifier groups" },
          { phrase: "Show me the add-on options", description: "Modifier list" },
        ],
      },
      {
        name: "apply_discount",
        description: "Apply a percentage or fixed-amount discount to the order or a specific item.",
        examples: [
          { phrase: "Comp the Bud Light", description: "100% discount on that item" },
          { phrase: "Give them 20% off", description: "20% discount on order" },
          { phrase: "Take five bucks off the total", description: "$5 fixed discount" },
        ],
      },
    ],
  },
  {
    title: "Orders & Sales",
    subtitle: "Review past orders, check open tickets, and pull sales reports on demand.",
    icon: <ClipboardList className="w-5 h-5" />,
    color: "text-amber-400",
    tools: [
      {
        name: "list_orders",
        description: "List recent orders with totals, item counts, and status.",
        examples: [
          { phrase: "Show me the last 10 orders", description: "Recent order list" },
          { phrase: "What orders came through?", description: "Recent orders summary" },
        ],
      },
      {
        name: "sales_report",
        description: "Get a full sales summary — revenue, order count, average ticket, and top sellers.",
        examples: [
          { phrase: "How did we do today?", description: "Today's sales report" },
          { phrase: "Give me this week's numbers", description: "This week's sales" },
          { phrase: "What were yesterday's sales?", description: "Yesterday's report" },
          { phrase: "Last 30 days revenue", description: "Monthly sales summary" },
        ],
      },
      {
        name: "list_open_orders",
        description: "See all currently open (in-progress) orders on the POS.",
        examples: [
          { phrase: "Any open orders?", description: "Lists in-progress orders" },
          { phrase: "What's still pending?", description: "Open order list" },
        ],
      },
      {
        name: "get_order_details",
        description: "Get the full breakdown of a specific order by its ID.",
        examples: [
          { phrase: "Pull up order ABC123", description: "Full order detail" },
        ],
      },
    ],
  },
  {
    title: "Locations",
    subtitle: "View all your Square locations and their details.",
    icon: <MapPin className="w-5 h-5" />,
    color: "text-rose-400",
    tools: [
      {
        name: "list_locations",
        description: "List all Square locations/venues for your merchant account with addresses and status.",
        examples: [
          { phrase: "What locations do we have?", description: "Lists all venues" },
          { phrase: "Show me our spots", description: "Location list" },
        ],
      },
    ],
  },
  {
    title: "Customers",
    subtitle: "Search, create, and manage customer profiles right from your voice.",
    icon: <Users className="w-5 h-5" />,
    color: "text-cyan-400",
    tools: [
      {
        name: "search_customer",
        description: "Search for a customer by name, email, or phone number. Fuzzy matching supported.",
        examples: [
          { phrase: "Look up John Smith", description: "Searches by name" },
          { phrase: "Find the customer with email john@bar.com", description: "Email search" },
          { phrase: "Who's the customer on 555-0123?", description: "Phone search" },
        ],
      },
      {
        name: "create_customer",
        description: "Create a new customer profile in Square with name, email, phone, and notes.",
        examples: [
          { phrase: "New customer — Jane Doe, jane@email.com", description: "Creates profile" },
          { phrase: "Add a customer: Mike, phone 555-0456", description: "Creates with phone" },
        ],
      },
      {
        name: "get_customer",
        description: "Get the full profile of a customer by their Square ID.",
        examples: [
          { phrase: "Pull up that customer's details", description: "Full customer profile" },
        ],
      },
      {
        name: "update_customer",
        description: "Update a customer's name, email, phone, or notes.",
        examples: [
          { phrase: "Update Jane's email to jane@newmail.com", description: "Updates email" },
          { phrase: "Add a note to Mike's profile — VIP regular", description: "Adds note" },
        ],
      },
    ],
  },
  {
    title: "Payments",
    subtitle: "View recent payments, issue refunds, and cancel pending transactions.",
    icon: <CreditCard className="w-5 h-5" />,
    color: "text-green-400",
    tools: [
      {
        name: "list_payments",
        description: "List recent payments with amounts, status, and timestamps.",
        examples: [
          { phrase: "Show me recent payments", description: "Lists last 10 payments" },
          { phrase: "What payments came through today?", description: "Payment list" },
        ],
      },
      {
        name: "refund_payment",
        description: "Refund a payment — full amount or a partial amount. Always confirms before executing.",
        examples: [
          { phrase: "Refund the last payment", description: "Full refund" },
          { phrase: "Refund five dollars on that payment", description: "Partial $5 refund" },
          { phrase: "Give them their money back — wrong order", description: "Full refund with reason" },
        ],
      },
      {
        name: "cancel_payment",
        description: "Cancel a payment that hasn't been completed yet.",
        examples: [
          { phrase: "Cancel that pending payment", description: "Cancels incomplete payment" },
        ],
      },
    ],
  },
  {
    title: "Team & Shifts",
    subtitle: "See who's working, clock people in and out, and manage your team.",
    icon: <UserCog className="w-5 h-5" />,
    color: "text-orange-400",
    tools: [
      {
        name: "list_team",
        description: "List all active team members at this location.",
        examples: [
          { phrase: "Who's on the team?", description: "Lists all team members" },
          { phrase: "Show me the staff", description: "Team member list" },
        ],
      },
      {
        name: "current_shifts",
        description: "See who is currently clocked in and working right now.",
        examples: [
          { phrase: "Who's on right now?", description: "Currently clocked-in staff" },
          { phrase: "Who's working?", description: "Active shifts" },
          { phrase: "Is Jake clocked in?", description: "Checks specific person" },
        ],
      },
      {
        name: "clock_in",
        description: "Clock in a team member to start their shift.",
        examples: [
          { phrase: "Clock in Jake", description: "Starts shift for Jake" },
          { phrase: "Jake's here, start his shift", description: "Clocks in" },
        ],
      },
      {
        name: "clock_out",
        description: "Clock out a team member to end their shift.",
        examples: [
          { phrase: "Clock out Jake", description: "Ends Jake's shift" },
          { phrase: "Jake's done for the night", description: "Clocks out" },
        ],
      },
    ],
  },
  {
    title: "Reports & Analytics",
    subtitle: "Pull detailed reports — hourly breakdowns, top sellers, and daily summaries.",
    icon: <BarChart3 className="w-5 h-5" />,
    color: "text-pink-400",
    tools: [
      {
        name: "hourly_sales",
        description: "Get an hour-by-hour sales breakdown for today or any specific date.",
        examples: [
          { phrase: "Hourly breakdown for today", description: "Sales by hour" },
          { phrase: "What were the busiest hours yesterday?", description: "Hourly report" },
        ],
      },
      {
        name: "item_performance",
        description: "See which items sold the most — ranked by revenue or quantity sold.",
        examples: [
          { phrase: "What's selling the most?", description: "Top items by revenue" },
          { phrase: "Top sellers this week by quantity", description: "Ranked by units sold" },
          { phrase: "What's our best seller this month?", description: "Top item" },
        ],
      },
      {
        name: "daily_summary",
        description: "Get a complete daily summary — order count, revenue, top items, and busiest hours.",
        examples: [
          { phrase: "Give me today's summary", description: "Full daily report" },
          { phrase: "How'd last Friday go?", description: "Summary for specific date" },
          { phrase: "End of day report", description: "Complete daily wrap-up" },
        ],
      },
    ],
  },
];

const slangGuide = [
  { phrase: "86 it", meaning: "Remove an item / mark as out of stock" },
  { phrase: "Ring it up", meaning: "Submit the current order" },
  { phrase: "Close it out", meaning: "Finalize and submit" },
  { phrase: "Tab it / Tab a …", meaning: "Add to the current order" },
  { phrase: "What's on the ticket?", meaning: "Read back the current order" },
  { phrase: "What's the damage?", meaning: "Get the order total" },
  { phrase: "Comp it", meaning: "Apply a 100% discount" },
  { phrase: "Who's on?", meaning: "Check who's clocked in" },
  { phrase: "We got a case of …", meaning: "Add 24 units to inventory" },
  { phrase: "Start fresh", meaning: "Clear the entire order" },
  { phrase: "Send it to the terminal", meaning: "Push order to card reader" },
  { phrase: "They want to tap", meaning: "Send to terminal for contactless" },
  { phrase: "Never mind / kill it", meaning: "Cancel / clear the order" },
  { phrase: "Another round", meaning: "Re-add the same items again" },
];

const timePeriods = [
  "today", "yesterday", "this week", "last 7 days", "this month", "last 30 days",
];

/* ── Components ────────────────────────────────────────────── */

function ToolCard({ tool, index }: { tool: ToolInfo; index: number }) {
  return (
    <motion.div
      custom={index}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-5"
    >
      <div className="flex items-start gap-3 mb-3">
        <code className="text-[12px] font-mono px-2 py-0.5 rounded-md bg-primary/10 text-primary shrink-0">
          {tool.name}
        </code>
      </div>
      <p className="text-[13px] text-foreground/60 font-light leading-relaxed mb-4">
        {tool.description}
      </p>
      <div className="space-y-2">
        {tool.examples.map((ex, j) => (
          <div key={j} className="flex items-start gap-2.5 group">
            <Mic className="w-3 h-3 mt-[5px] text-foreground/20 group-hover:text-primary/60 transition-colors shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] text-foreground/80 font-medium leading-snug">
                "{ex.phrase}"
              </p>
              <p className="text-[11px] text-foreground/40 font-light mt-0.5">
                {ex.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function DomainBlock({ domain, index }: { domain: DomainSection; index: number }) {
  return (
    <motion.section
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      className="scroll-mt-24"
      id={domain.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
    >
      <motion.div custom={0} variants={fadeUp} className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className={`${domain.color}`}>{domain.icon}</div>
          <h2 className="font-display font-semibold text-xl tracking-tight">{domain.title}</h2>
          <span className="text-[11px] text-foreground/30 font-light ml-auto">
            {domain.tools.length} {domain.tools.length === 1 ? "tool" : "tools"}
          </span>
        </div>
        <p className="text-[13px] text-foreground/50 font-light leading-relaxed max-w-2xl">
          {domain.subtitle}
        </p>
      </motion.div>

      <div className="grid gap-3 sm:grid-cols-2">
        {domain.tools.map((tool, i) => (
          <ToolCard key={tool.name} tool={tool} index={i + 1} />
        ))}
      </div>
    </motion.section>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function Capabilities() {
  const totalTools = domains.reduce((sum, d) => sum + d.tools.length, 0);

  return (
    <div className="pt-28 pb-20">
      <div className="max-w-5xl mx-auto px-6 lg:px-8">

        {/* ── Back link ─────────────────────────────────────── */}
        <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-foreground/40 hover:text-foreground/70 transition-colors mb-10">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to home
        </Link>

        {/* ── Hero ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
          className="mb-16"
        >
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Volume2 className="w-4 h-4 text-primary" />
            </div>
            <span className="text-[11px] font-medium tracking-[0.15em] uppercase text-foreground/40">
              Voice Command Reference
            </span>
          </div>
          <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight mb-4">
            Everything BevPro Can Do
          </h1>
          <p className="text-[15px] text-foreground/50 font-light leading-relaxed max-w-2xl">
            {totalTools} voice-powered tools across {domains.length} domains — ordering, inventory, catalog management,
            customers, payments, team scheduling, and analytics. All accessible through natural conversation.
          </p>
        </motion.div>

        {/* ── Quick nav ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mb-16 p-5 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]"
        >
          <p className="text-[11px] font-medium tracking-[0.15em] uppercase text-foreground/30 mb-3">Jump to</p>
          <div className="flex flex-wrap gap-2">
            {domains.map((d) => (
              <a
                key={d.title}
                href={`#${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg bg-foreground/[0.04] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.08] transition-colors"
              >
                <span className={d.color}>{d.icon}</span>
                {d.title}
                <span className="text-foreground/25 text-[11px]">{d.tools.length}</span>
              </a>
            ))}
          </div>
        </motion.div>

        {/* ── How it works ──────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease }}
          className="mb-16 p-6 rounded-xl border border-primary/10 bg-primary/[0.03]"
        >
          <div className="flex items-center gap-2.5 mb-4">
            <MessageSquare className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold text-lg">How Voice Commands Work</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 text-[13px] text-foreground/60 font-light leading-relaxed">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary">1</div>
                <span className="font-medium text-foreground/80">Speak naturally</span>
              </div>
              <p>No rigid commands — just talk like you would to a coworker. BevPro understands bartender slang, casual language, and context.</p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary">2</div>
                <span className="font-medium text-foreground/80">AI picks the tool</span>
              </div>
              <p>BevPro's AI understands your intent and automatically selects the right tool — no menus, no tapping, no button hunting.</p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary">3</div>
                <span className="font-medium text-foreground/80">Square executes</span>
              </div>
              <p>The action runs directly against your Square account — orders appear on the POS, inventory updates in real time, reports pull live data.</p>
            </div>
          </div>
        </motion.div>

        {/* ── Domain sections ───────────────────────────────── */}
        <div className="space-y-16">
          {domains.map((domain, i) => (
            <DomainBlock key={domain.title} domain={domain} index={i} />
          ))}
        </div>

        {/* ── Bartender Slang Guide ─────────────────────────── */}
        <motion.section
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
          className="mt-20"
          id="slang-guide"
        >
          <motion.div custom={0} variants={fadeUp} className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="w-5 h-5 text-[#E8A020]" />
              <h2 className="font-display font-semibold text-xl tracking-tight">Bartender Slang Guide</h2>
            </div>
            <p className="text-[13px] text-foreground/50 font-light leading-relaxed max-w-2xl">
              BevPro understands how bartenders actually talk. Here's a cheat sheet of slang that works out of the box.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-2">
            {slangGuide.map((item, i) => (
              <motion.div
                key={item.phrase}
                custom={i}
                variants={fadeUp}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02]"
              >
                <code className="text-[12px] font-mono text-[#E8A020] shrink-0 min-w-[140px]">
                  "{item.phrase}"
                </code>
                <ChevronRight className="w-3 h-3 text-foreground/20 shrink-0" />
                <span className="text-[12px] text-foreground/50 font-light">{item.meaning}</span>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── Time periods ──────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease }}
          className="mt-16 p-6 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]"
        >
          <h3 className="font-display font-semibold text-base mb-3">Supported Time Periods for Reports</h3>
          <p className="text-[13px] text-foreground/50 font-light mb-4">
            Use any of these naturally when asking for sales reports, item performance, or daily summaries:
          </p>
          <div className="flex flex-wrap gap-2">
            {timePeriods.map((p) => (
              <span key={p} className="text-[12px] font-mono px-3 py-1.5 rounded-lg bg-foreground/[0.04] text-foreground/60">
                "{p}"
              </span>
            ))}
          </div>
        </motion.section>

        {/* ── CTA ───────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease }}
          className="mt-20 text-center"
        >
          <h2 className="font-display font-semibold text-2xl tracking-tight mb-3">
            Ready to go hands-free?
          </h2>
          <p className="text-[13px] text-foreground/50 font-light mb-6 max-w-md mx-auto">
            Connect your Square account and start running your bar with your voice. Free 14-day trial.
          </p>
          <Link href="/signup">
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium text-[14px] hover:opacity-90 transition-opacity">
              Get Started Free
              <ChevronRight className="w-4 h-4" />
            </button>
          </Link>
        </motion.div>

      </div>
    </div>
  );
}
