import { RepresentativeApplicationWizard } from "@/components/representative-application-wizard";

export const metadata = {
  title: "Solicitação para representante",
  robots: { index: false, follow: false }
};

export default function RepresentativeApplicationPage() {
  return (
    <main className="container page-shell representative-application-page account-experience-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Programa curti Z</p>
          <h1>Solicitação para representante</h1>
          <p>Preencha com atenção. O processo pode ser salvo e retomado.</p>
        </div>
      </div>
      <RepresentativeApplicationWizard />
    </main>
  );
}
