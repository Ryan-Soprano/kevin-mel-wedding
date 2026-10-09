import ContributionForm from "../features/contribution/components/ContributionForm.jsx";
import PhotoBatchForm from "../features/media/components/PhotoBatchForm.jsx";

export default function App() {
  return (
    <main>
      <h1>Kevin &amp; Melanie</h1>
      <p>Help us remember tonight.</p>
      <p>Leave a message for us to treasure for the years ahead!</p>

      <ContributionForm />
      <PhotoBatchForm />
    </main>
  );
}
