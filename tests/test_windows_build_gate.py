import importlib.util,pathlib,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('gate',ROOT/'scripts/windows-build-gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
SHA='a'*40
class WindowsBuildGateTests(unittest.TestCase):
 def check(self,count,message='',event='push',ref=gate.DEV_REF):return gate.decide(count,SHA,event,ref,message)
 def test_only_exact_milestones_build_on_ordinary_push(self):
  for count in (1,49,51,99,101):self.assertFalse(self.check(count)['build'])
  for count in (50,100,150):self.assertEqual(self.check(count)['kind'],'milestone')
 def test_explicit_recovery_keeps_actual_source_and_separate_milestone(self):
  result=self.check(54,'Fix browser clock harness\n\nWindows-Recovery-For: 50\n')
  self.assertTrue(result['build']);self.assertEqual(result['count'],54);self.assertEqual(result['sha'],SHA);self.assertEqual(result['recovery_for'],50);self.assertEqual(result['label'],'commit-54-recovery-for-50')
 def test_wrong_interval_duplicates_or_malformed_trailers_fail_closed(self):
  for count,message in [(54,'Windows-Recovery-For: 49'),(50,'Windows-Recovery-For: 50'),(101,'Windows-Recovery-For: 50'),(49,'Windows-Recovery-For: 50'),(54,'Windows-Recovery-For: 050'),(54,'Windows-Recovery-For: -50'),(54,'Windows-Recovery-For: 50 extra'),(54,'Windows-Recovery-For: 50\nWindows-Recovery-For: 50'),(54,'Windows-Recovery-For: not-a-number')]:
   with self.subTest(count=count,message=message),self.assertRaises(ValueError):self.check(count,message)
 def test_recovery_never_activates_on_other_branches_or_events(self):
  for ref in ('refs/heads/main','refs/pull/1/merge','refs/tags/v0.1.0'):
   self.assertFalse(self.check(54,'Windows-Recovery-For: 50',ref=ref)['build'])
  self.assertFalse(self.check(54,'Windows-Recovery-For: 50',event='pull_request')['build'])
  self.assertEqual(self.check(54,'Windows-Recovery-For: 50',event='workflow_dispatch')['recovery_for'],0)
 def test_mentioning_the_marker_in_prose_does_not_trigger_a_build(self):
  self.assertFalse(self.check(54,'Document Windows-Recovery-For: 50 as an example')['build'])
if __name__=='__main__':unittest.main()
