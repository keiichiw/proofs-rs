# Discuss a report

Comments are the place for public questions, objections, and responses about a
Report. Review is not limited to the proof itself: the specification, assumptions,
verification scope, tool limitations, and reproducibility are all fair topics.

## Before you comment

Sign in with GitHub and accept the current Terms. The **Comments** section at the
bottom of each Report then shows a comment form. Comments are published under
CC BY 4.0, like other contributions; see [Why proofs.rs](introduction.md#position-and-policy).

You do not need a counterexample or a complete investigation to comment. A clear
question about a specification or assumption is a useful contribution.

## Write a useful comment

Say what your comment is about and what you observed:

- **Target:** the Claim number or API. Select the Report revision you read in
  the comment form.
- **Concern:** for example, a precondition that excludes inputs that matter in
  practice, a specification that also allows a trivial implementation, an
  assumption that does not hold for your target, or a scope narrower than the
  Overview suggests.
- **Observation:** what you tried and what happened. If you could not reproduce
  the run, include the commit, tool version, command, and relevant log lines.

For example:

```text
Claim #12 (revision 3): the precondition requires `len < 1024`, but callers in
practice pass buffers up to 64 KiB. Does the panic-freedom result extend to larger
inputs, or should the Overview mention this bound?
```

Keep discussion technical and specific. Under the [Terms](/terms), content may
be hidden or removed to keep discussion orderly.

## How discussion works

- Comments belong to the Report and record the revision they are about. The
  comment form has a revision selector, preset to the revision you are viewing
  or, for a reply, to the parent comment's revision. Check it before posting,
  especially when commenting on an older revision. Discussion carries over when
  the Report is revised.
- You can reply to any comment, forming a thread, and vote other people's
  comments up or down.
- You can edit or delete your own comments. A deleted comment leaves a public
  placeholder in the thread.
- The Report's author and the people you reply to are notified by email, if they
  have enabled notifications in Settings.

## For authors: respond to discussion

Reply to each substantive comment. If you change the Report in response, publish
a revision and link it in your reply. If a comment reveals something worth
recording, such as a bug or a missing precondition, add it as a
[Finding](findings.md) so that it appears on the Report and crate pages.

To report a problem with proofs.rs itself rather than a Report, see
[Get help and give feedback](get-help.md).
