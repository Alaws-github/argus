// TEMPLATE: copy this file to a new name such as 06-my-client.mjs (files
// starting with "_" are skipped) and fill it in. Run it on its own with
//   npm run demo -- --only=my-client
// after stopping the app, npm run db:reset and starting it again.
//
// Everything goes through the real API, as the five demo people:
//   ctx.andrew (admin), ctx.jordan (lead), ctx.riley (reviewer),
//   ctx.sam (preparer), ctx.dana (viewer)
// Helpers (see ../lib.mjs):
//   ctx.configure({ modules, appetite, access })   modules: evals, incidents, inventory, connectors, soa, advanced_ai
//   ctx.knowledge(title, [paragraphs])              a client document the AI may cite
//   ctx.useCase({...})                              quick add; returns the card (card.key is e.g. ABC-1)
//   ctx.plan([messages], { add: true })             raise it with the Use Case Planner, then add to Intake
//   ctx.toClassification(key)                       a reviewer takes it forward; the AI drafts the risk
//   ctx.approveClassification(key, { decide })      decide items (ctx.edit / ctx.reject), then approve
//   ctx.approveDesign(key)                          approve the controls; the AI drafts evidence requests
//   ctx.verify(key)                                 the Verifier checks the draft against its sources
//   ctx.issue({...})                                raise an issue
// Anything else: call the API directly, e.g. await ctx.sam('POST', `/engagements/${ctx.E}/...`, {...}).
export const engagement = {
  name: 'Engagement name',
  client: 'Client name (demo)',
  prefix: 'ABC',                       // card keys become ABC-1, ABC-2...
  color: '#8b9dff',
  sector: 'Sector',
  frameworks: ['nistAiRmf', 'iso42001'], // also: euAiAct, jdpa, nistCsf, coso
  about: 'Who the client is, its regulators and anything that changes how risk is judged. Every agent reads this.',
  appetite: { maxResidual: 8, statement: 'What risk the client accepts.', escalateTo: 'Board Risk Committee' },
};

export async function build(ctx, { step }) {
  await ctx.configure({ modules: {} });
  const uc = await ctx.useCase({
    title: 'Use case title', businessOwner: 'Role of the owner',
    description: 'What the AI does, who acts on its output, how often.',
    dataUsed: 'Every data source; say if any of it identifies a person.',
    affectedPeople: 'Who is affected, roughly how many.',
    autonomy: 'human_in_loop', vendor: 'In-house', category: 'decision', priority: 'p2',
  });
  await ctx.toClassification(uc.key);
  step(`${uc.key} drafted by the AI, waiting for decisions`);
}
