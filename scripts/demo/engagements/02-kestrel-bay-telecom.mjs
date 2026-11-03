// Kestrel Bay Telecom: a mobile and broadband operator in Jamaica and the
// Eastern Caribbean, regulated by the Office of Utilities Regulation. It is
// putting generative AI in front of customers and wants assurance before the
// regulator asks. Modules: AI testing and monitoring, AI inventory.
export const engagement = {
  name: 'Customer AI readiness review',
  client: 'Kestrel Bay Telecom (demo)',
  prefix: 'KBT',
  color: '#3fb6c9',
  sector: 'Telecommunications',
  frameworks: ['nistAiRmf', 'iso42001', 'jdpa'],
  about: 'Mobile and broadband operator, about 1.1 million subscribers in Jamaica and four Eastern Caribbean markets. Regulated by the Office of Utilities Regulation (OUR) and, for customer data, the Jamaica Data Protection Act 2020. Customer care is moving to WhatsApp and app chat; the board wants AI that touches customers or their bills reviewed before it goes live.',
  appetite: { maxResidual: 8, statement: 'Low residual risk for back-office AI. Anything that changes a customer\'s bill, service or identity above a residual of 8 goes to the Audit and Risk Committee.', escalateTo: 'Audit and Risk Committee' },
};

export async function build(ctx, { step }) {
  const { andrew, riley } = ctx;
  await ctx.configure({ modules: { evals: true, inventory: true } });
  await ctx.knowledge('Kestrel Bay customer care policy: refunds and credits (2026)', [
    '1. Bill credits. Agents may credit up to J$5,000 per account per month for service failures. Larger credits need a team leader.',
    '2. Promises. No one may promise a refund, discount or fee waiver that is not in the published price list. A promise made in writing to a customer is honoured.',
    '3. Identity. A SIM replacement needs the customer\'s ID in store, or a one-time code to the registered email for low-risk accounts.',
    '4. AI. Any AI that talks to customers must say it is an AI in its first message, hand over to a person on request, and keep a transcript for 12 months.',
  ]);
  step('Care policy added to the knowledge base, so the agents can cite it');

  const refund = await ctx.useCase({
    title: 'Care+ refund and billing agent', businessOwner: 'Head of Customer Care',
    description: 'A generative AI agent on WhatsApp and the app answers billing questions and can apply bill credits up to J$5,000 by itself through the billing system. It explains fees and roaming charges. A tribunal elsewhere has held a company liable for a refund policy its chatbot invented, so care wants to know what the agent may promise.',
    dataUsed: 'Customer name, account number, last 6 bills, usage records, chat history; credits are written to the billing system.',
    affectedPeople: 'Postpaid and prepaid customers who contact care, about 60,000 chats a month.',
    autonomy: 'human_on_loop', vendor: 'Large language model through a cloud AI service, with the operator\'s own tools', category: 'agent', priority: 'p1',
  });
  await ctx.toClassification(refund.key);
  await ctx.verify(refund.key);
  await ctx.approveClassification(refund.key, {
    decide: async (id, c) => {
      const i = c.classification.risks.findIndex((r) => /accur|harm|safety/i.test(r.category));
      if (i >= 0) await ctx.edit(id, `risk:${i}`, { impact: 4 }, 'A wrong promise becomes binding under policy section 2; impact raised');
    },
  });
  step(`${refund.key} Care+ refund agent: classified (impact of a wrong promise raised by Riley), controls drafted and waiting`);

  const sim = await ctx.useCase({
    title: 'SIM-swap fraud scoring', businessOwner: 'Head of Fraud and Revenue Assurance',
    description: 'Scores every SIM replacement request from 0 to 100. Above 70 the swap is held and the customer is asked to visit a store with ID; below 70 it goes through with a one-time code. SIM-swap fraud is used to take over bank accounts that rely on SMS codes.',
    dataUsed: 'Request channel, device and location signals, account age, recent changes to the account, ID check outcome.',
    affectedPeople: 'Customers asking for a new SIM, about 9,000 a month, and anyone whose phone number protects a bank account.',
    autonomy: 'human_in_loop', vendor: 'In-house gradient-boosted model', category: 'decision', priority: 'p1',
  });
  await ctx.toClassification(sim.key);
  await ctx.verify(sim.key);
  step(`${sim.key} SIM-swap fraud scoring: classification drafted and checked by the Verifier, waiting for Riley`);

  const churn = await ctx.useCase({
    title: 'Churn-risk retention offers', businessOwner: 'Director of Consumer Marketing',
    description: 'Ranks prepaid customers by their chance of leaving and sends the top 5% a discount bundle by SMS automatically each week. Marketing has noticed offers cluster in some parishes, which may mean the model is using location as a stand-in for income.',
    dataUsed: 'Top-up history, data use, tower location by parish, device model, complaints.',
    affectedPeople: 'Prepaid customers, about 800,000.', autonomy: 'autonomous', vendor: 'In-house', category: 'decision', priority: 'p2',
  });
  step(`${churn.key} Churn-risk retention offers: in Intake, waiting for someone to take it forward`);

  await ctx.plan([
    'We want an AI voice for our phone line that speaks Jamaican Patois and English and sounds like a real agent, using voice clones of three of our call centre staff.',
    'Patois voice agent for the care line',
    'Head of Customer Care',
  ]);
  step('A plan in progress with the Use Case Planner: a voice-cloned Patois care line');
}
